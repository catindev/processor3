import { HttpError } from './errors.js';
import {
  applyStepEffect,
  executeStep,
  planStep,
  reduceStep,
  resumeProcess,
  startProcess,
  validateStateShape
} from './process-kernel.js';
import { buildFlowGraphDocument } from './flow-graph.js';

function ensureObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', message);
  }
}

function assertStateCommand(body) {
  ensureObject(body, 'Request body must be an object.');
  validateStateShape(body.state);
  return body.state;
}

function assertStepResultBody(body, resultFieldName) {
  const state = assertStateCommand(body);
  if (!body.stepId || typeof body.stepId !== 'string') {
    throw new HttpError(400, 'request_error', 'REQUEST_INVALID', 'stepId is required and must be a string.', {
      field: 'stepId'
    });
  }
  ensureObject(body[resultFieldName], `${resultFieldName} is required and must be an object.`);
  return { state, stepId: body.stepId, result: body[resultFieldName] };
}

export function createProcessor(runtime) {
  function runtimeInfo() {
    return {
      ready: Boolean(runtime.ready && runtime.project),
      defaultFlow: runtime.defaultFlow,
      flows: runtime.flows,
      diagnostics: runtime.diagnostics
    };
  }

  function assertRuntimeReady() {
    if (!(runtime.ready && runtime.project)) {
      throw new HttpError(503, 'runtime_unavailable', 'PROJECT_NOT_READY', 'Processor runtime is not ready.', {
        diagnostics: runtime.diagnostics
      });
    }
    return runtime.project;
  }

  return {
    health() {
      const ready = Boolean(runtime.ready && runtime.project);
      return {
        statusCode: ready ? 200 : 503,
        body: {
          status: ready ? 'ready' : 'not_ready',
          artifactRuntime: runtimeInfo()
        }
      };
    },

    listFlows() {
      const project = assertRuntimeReady();
      return { flows: project.listFlows() };
    },

    async describeFlow(flowId, flowVersion) {
      const project = assertRuntimeReady();
      const runtime = project.getRuntime(flowId, flowVersion);
      const artifactContext = {
        getMappingSource: (id) => runtime.mappings.get(id)?.source ?? null,
        getDecisionArtifacts: () => runtime.decisionsSource?.artifacts ?? [],
      };
      return await buildFlowGraphDocument(runtime.flowSource, artifactContext);
    },

    init(body) {
      const project = assertRuntimeReady();
      return { state: startProcess(project, body) };
    },

    step(body) {
      const project = assertRuntimeReady();
      return { step: planStep(project, assertStateCommand(body)) };
    },

    run(body) {
      const project = assertRuntimeReady();
      const state = assertStateCommand(body);
      const step = planStep(project, state);
      if (step.type !== 'PROCESS') {
        throw new HttpError(409, 'runtime_error', 'STEP_TYPE_INVALID', `Current step type ${step.type} is not supported by /run.`, {
          expectedType: 'PROCESS',
          actualType: step.type ?? null,
          currentStepId: step.id ?? state.currentStepId
        });
      }
      const output = executeStep(project, state, step);
      return { state: reduceStep(project, state, step, output) };
    },

    route(body) {
      const project = assertRuntimeReady();
      const state = assertStateCommand(body);
      const step = planStep(project, state);
      if (step.type !== 'CONTROL') {
        throw new HttpError(409, 'runtime_error', 'STEP_TYPE_INVALID', `Current step type ${step.type} is not supported by /route.`, {
          expectedType: 'CONTROL',
          actualType: step.type ?? null,
          currentStepId: step.id ?? state.currentStepId
        });
      }
      return { state: reduceStep(project, state, step, null) };
    },

    apply(body) {
      const project = assertRuntimeReady();
      const { state, stepId, result } = assertStepResultBody(body, 'effectResult');
      return { state: applyStepEffect(project, state, stepId, result) };
    },

    resume(body) {
      const project = assertRuntimeReady();
      const { state, stepId, result } = assertStepResultBody(body, 'waitResult');
      return { state: resumeProcess(project, state, stepId, result) };
    },

    execute() {
      throw new HttpError(410, 'deprecated_endpoint', 'ENDPOINT_DEPRECATED', 'Endpoint /execute is deprecated. Use /run for PROCESS and /route for CONTROL.', {
        replacementEndpoints: ['/run', '/route']
      });
    }
  };
}
