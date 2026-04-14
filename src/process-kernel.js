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

function ensureObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, message);
  }
}

function mapRuntimeError(error) {
  if (error instanceof HttpError) return error;
  if (error && typeof error === 'object' && 'name' in error && String(error.name).includes('RuntimeError')) {
    return new HttpError(409, error.message, { name: error.name, code: error.code, details: error.details });
  }
  return new HttpError(409, error?.message || 'Runtime error.', { name: error?.name || 'Error' });
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
    throw new HttpError(409, 'Mapping step expects object input for multi-source mapping.');
  }
  const wrapped = {};
  for (const sourceName of mappingMeta.sourceNames) {
    if (!(sourceName in input)) {
      throw new HttpError(409, `Mapping input is missing source object: ${sourceName}`);
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
  ensureObject(state, 'Request body must be a ProcessState object.');
  for (const key of ['processId', 'id', 'version', 'status', 'traceMode', 'currentStepId', 'currentStepType', 'currentStepSubtype', 'context', 'history', 'result', 'meta']) {
    if (!(key in state)) {
      throw new HttpError(400, `ProcessState is missing required field: ${key}`);
    }
  }
  if (!['off', 'basic', 'verbose'].includes(state.traceMode)) {
    throw new HttpError(400, 'ProcessState.traceMode must be one of: off, basic, verbose.');
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
  return next;
}

export function startProcess(project, request) {
  ensureObject(request, 'Request body must be an object.');
  if (!request.processId || typeof request.processId !== 'string') {
    throw new HttpError(400, 'processId is required and must be a string.');
  }
  ensureObject(request.application, 'application is required and must be an object.');
  const rawApplication = request.application.payload ?? request.application;
  ensureObject(rawApplication, 'application payload must be an object.');
  const currentDate = request.application?.context?.currentDate ?? request.context?.currentDate ?? new Date().toISOString().slice(0, 10);
  const flowId = request.flowId ? String(request.flowId) : project.defaultRuntime.flowInfo.id;
  const flowVersion = request.flowVersion ? String(request.flowVersion) : (flowId === project.defaultRuntime.flowInfo.id ? project.defaultRuntime.flowInfo.version : undefined);
  const runtime = project.getRuntime(flowId, flowVersion);
  try {
    const createdState = semantics.createProcessState({
      flow: runtime.preparedFlow,
      processId: request.processId,
      input: {
        application: cloneJson(rawApplication),
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
    throw new HttpError(409, 'executeStep only supports PROCESS steps.');
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
    throw new HttpError(409, `Unsupported PROCESS subtype: ${plannedStep.subtype}`);
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
  ensureObject(value, `${label} is required and must be an object.`);
  if (!value.requestId || typeof value.requestId !== 'string') {
    throw new HttpError(400, `${label}.requestId is required and must be a string.`);
  }
  if (value.result != null && value.error != null) {
    throw new HttpError(400, `${label} must not contain both result and error.`);
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
    throw new HttpError(400, 'stepId is required and must be a string.');
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
    throw new HttpError(400, 'stepId is required and must be a string.');
  }
  const runtime = project.getRuntimeByState(state);
  try {
    const nextState = semantics.resume(runtime.preparedFlow, cloneJson(state), stepId, normalizeExternalResult(waitResult, 'waitResult'));
    return normalizeStateForTransport(runtime, nextState);
  } catch (error) {
    throw mapRuntimeError(error);
  }
}
