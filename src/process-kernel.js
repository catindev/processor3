import { createRequire } from 'node:module';
import * as semantics from '@processengine/semantics';
import * as mappings from '@processengine/mappings';
import * as rules from '@processengine/rules';
import { HttpError } from './errors.js';

const require = createRequire(import.meta.url);
const decisions = require('@processengine/decisions');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureObject(value, message, details = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', message, details);
  }
}

function isSemanticsRuntimeError(error) {
  if (!error || typeof error !== 'object') return false;
  // XRuntimeError from @processengine/semantics always carries a string error.code
  // starting with FLOW_. This is more stable than matching the class name string.
  if (typeof error.code === 'string' && error.code.startsWith('FLOW_')) return true;
  // Fallback: constructor name check for forward-compatibility
  if (error.constructor?.name === 'XRuntimeError') return true;
  return false;
}

function mapRuntimeError(error) {
  if (error instanceof HttpError) return error;
  if (isSemanticsRuntimeError(error)) {
    return new HttpError(409, 'runtime_error', 'WORKFLOW_STATE_INVALID', error.message, {
      semanticsErrorName: error.name,
      semanticsErrorCode: error.code ?? null,
      semanticsDetails: error.details ?? {}
    });
  }
  return new HttpError(409, 'runtime_error', 'WORKFLOW_STATE_INVALID', error?.message || 'Workflow state is invalid.', {
    causeName: error?.name || 'Error'
  });
}

function normalizeDecisionResult(raw) {
  return {
    outcome: raw.decision,
    reason: raw.reason,
    engineStatus: raw.status
  };
}

function wrapMappingInput(mappingMeta, input) {
  if (mappingMeta.sourceNames.length === 1) {
    return { [mappingMeta.sourceNames[0]]: input };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(409, 'runtime_error', 'WORKFLOW_STATE_INVALID', 'Mapping step expects object input for multi-source mapping.');
  }
  const wrapped = {};
  for (const sourceName of mappingMeta.sourceNames) {
    if (!(sourceName in input)) {
      throw new HttpError(409, 'runtime_error', 'WORKFLOW_STATE_INVALID', `Mapping input is missing source object: ${sourceName}`, {
        sourceName
      });
    }
    wrapped[sourceName] = input[sourceName];
  }
  return wrapped;
}

function normalizeRulesInput(stepInput) {
  if (stepInput && typeof stepInput === 'object' && !Array.isArray(stepInput) && 'payload' in stepInput) {
    return {
      payload: stepInput.payload,
      context: stepInput.context && typeof stepInput.context === 'object' ? stepInput.context : {}
    };
  }
  return { payload: stepInput, context: {} };
}

export function validateStateShape(state) {
  ensureObject(state, 'Request body must contain a valid ProcessState in the state field.');
  // traceMode is excluded from required-field check: absent or unknown values
  // are normalised to 'off' rather than rejected, so external callers do not
  // have to track the enum. All other fields are load-bearing and must be present.
  for (const key of ['processId', 'id', 'version', 'status', 'currentStepId', 'currentStepType', 'currentStepSubtype', 'context', 'history', 'result', 'meta']) {
    if (!(key in state)) {
      throw new HttpError(400, 'request_error', 'REQUEST_INVALID', `ProcessState is missing required field: ${key}`, { field: key });
    }
  }
}

export function normalizeStateForTransport(runtime, state) {
  const next = cloneJson(state);
  next.processId = String(next.processId ?? '');
  next.id = String(next.id ?? runtime.flowInfo.id);
  next.version = String(next.version ?? runtime.flowInfo.version);
  next.status = String(next.status ?? 'ACTIVE');
  next.traceMode = ['off', 'basic', 'verbose'].includes(next.traceMode) ? next.traceMode : 'off';
  next.currentStepId = String(next.currentStepId ?? '');
  next.currentStepType = String(next.currentStepType ?? '');
  next.currentStepSubtype = String(next.currentStepSubtype ?? '');
  if (!next.context || typeof next.context !== 'object' || Array.isArray(next.context)) next.context = {};
  for (const zone of ['input', 'checks', 'facts', 'decisions', 'steps', 'effects']) {
    if (!next.context[zone] || typeof next.context[zone] !== 'object' || Array.isArray(next.context[zone])) next.context[zone] = {};
  }
  if (!Array.isArray(next.history)) next.history = [];
  if (!('result' in next)) next.result = null;
  if (!next.meta || typeof next.meta !== 'object' || Array.isArray(next.meta)) next.meta = {};
  return applyPrecomputedTerminalResult(next);
}

function applyPrecomputedTerminalResult(state) {
  if (!['COMPLETE', 'FAIL'].includes(state.status)) {
    return state;
  }
  const terminalResult = state.context?.facts?.terminalResult;
  if (!isPlainObject(terminalResult)) {
    return state;
  }
  state.result = cloneJson(terminalResult);
  return state;
}

export function startProcess(project, request) {
  ensureObject(request, 'Request body must be an object.');
  if (!request.processId || typeof request.processId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'processId is required and must be a string.', {
      field: 'processId'
    });
  }
  if (request.flowId != null && typeof request.flowId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'flowId must be a string when provided.', {
      field: 'flowId'
    });
  }
  if (request.flowVersion != null && typeof request.flowVersion !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'flowVersion must be a string when provided.', {
      field: 'flowVersion'
    });
  }
  ensureObject(request.input, 'input is required and must be an object.', { field: 'input' });
  ensureObject(request.input.application, 'input.application is required and must be an object.', { field: 'input.application' });
  if (request.input.currentDate != null && typeof request.input.currentDate !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'input.currentDate must be a string when provided.', {
      field: 'input.currentDate'
    });
  }

  const currentDate = request.input.currentDate ?? new Date().toISOString().slice(0, 10);
  const flowId = request.flowId ? String(request.flowId) : project.defaultRuntime.flowInfo.id;
  const flowVersion = request.flowVersion ? String(request.flowVersion) : (flowId === project.defaultRuntime.flowInfo.id ? project.defaultRuntime.flowInfo.version : undefined);
  const runtime = project.getRuntime(flowId, flowVersion);

  try {
    const createdState = semantics.createProcessState({
      flow: runtime.preparedFlow,
      processId: request.processId,
      input: {
        application: cloneJson(request.input.application),
        currentDate
      },
      meta: {
        artifactSetId: runtime.manifest.artifactSetId,
        artifactSetVersion: runtime.manifest.artifactSetVersion
      },
      trace: runtime.config.traceMode
    });
    return normalizeStateForTransport(runtime, createdState);
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export function planStep(project, state) {
  validateStateShape(state);
  const runtime = project.getRuntimeByState(state);
  try {
    return semantics.plan(runtime.preparedFlow, cloneJson(state));
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export function executeStep(project, state, step = undefined) {
  validateStateShape(state);
  const runtime = project.getRuntimeByState(state);
  const plannedStep = step ?? planStep(project, state);
  if (plannedStep.type !== 'PROCESS') {
    throw new HttpError(409, 'runtime_error', 'STEP_TYPE_INVALID', 'Current step is not a PROCESS step.', {
      expectedType: 'PROCESS',
      actualType: plannedStep.type ?? null,
      currentStepId: plannedStep.id ?? state.currentStepId
    });
  }
  try {
    if (plannedStep.subtype === 'RULES') {
      const input = normalizeRulesInput(plannedStep.input);
      return rules.evaluateRules(runtime.preparedRules, {
        pipelineId: plannedStep.artefactId,
        payload: input.payload,
        context: input.context
      });
    }
    if (plannedStep.subtype === 'MAPPINGS') {
      const mappingMeta = runtime.getMapping(plannedStep.artefactId);
      return mappings.executeMappings(mappingMeta.prepared, wrapMappingInput(mappingMeta, plannedStep.input)).output;
    }
    if (plannedStep.subtype === 'DECISIONS') {
      return normalizeDecisionResult(decisions.evaluate(runtime.compiledDecisions, plannedStep.artefactId, plannedStep.input));
    }
    throw new HttpError(409, 'runtime_error', 'WORKFLOW_STATE_INVALID', `Unsupported PROCESS subtype: ${plannedStep.subtype}`, {
      subtype: plannedStep.subtype ?? null
    });
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export function reduceStep(project, state, step, stepOutput) {
  validateStateShape(state);
  const runtime = project.getRuntimeByState(state);
  try {
    return normalizeStateForTransport(runtime, semantics.reduce(step, cloneJson(state), stepOutput));
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

function normalizeExternalResult(value, label) {
  ensureObject(value, `${label} is required and must be an object.`, { field: label });
  if (!value.requestId || typeof value.requestId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', `${label}.requestId is required and must be a string.`, {
      field: `${label}.requestId`
    });
  }
  if (value.result != null && value.error != null) {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', `${label} must not contain both result and error.`, {
      field: label
    });
  }
  return cloneJson({
    requestId: value.requestId,
    result: value.result ?? null,
    error: value.error ?? null,
    errorCode: value.errorCode ?? null
  });
}

export function applyStepEffect(project, state, stepId, effectResult) {
  validateStateShape(state);
  if (!stepId || typeof stepId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'stepId is required and must be a string.', {
      field: 'stepId'
    });
  }
  const runtime = project.getRuntimeByState(state);
  try {
    const nextState = semantics.apply(runtime.preparedFlow, cloneJson(state), stepId, normalizeExternalResult(effectResult, 'effectResult'));
    return normalizeStateForTransport(runtime, nextState);
  } catch (error) {
    throw mapRuntimeError(error);
  }
}

export function resumeProcess(project, state, stepId, waitResult) {
  validateStateShape(state);
  if (!stepId || typeof stepId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'stepId is required and must be a string.', {
      field: 'stepId'
    });
  }
  const runtime = project.getRuntimeByState(state);
  try {
    const nextState = semantics.resume(runtime.preparedFlow, cloneJson(state), stepId, normalizeExternalResult(waitResult, 'waitResult'));
    return normalizeStateForTransport(runtime, nextState);
  } catch (error) {
    throw mapRuntimeError(error);
  }
}
