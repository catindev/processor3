import { HttpError } from './errors.js';
import {
  applyStepEffect,
  executeStep,
  normalizeStateForTransport,
  planStep,
  reduceStep,
  resumeProcess,
  startProcess,
  validateStateShape
} from './process-kernel.js';

function ensureObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, message);
  }
}

function assertStepResultBody(body, resultFieldName) {
  ensureObject(body, 'Request body must be an object.');
  validateStateShape(body.state);
  if (!body.stepId || typeof body.stepId !== 'string') {
    throw new HttpError(400, 'stepId is required and must be a string.');
  }
  ensureObject(body[resultFieldName], `${resultFieldName} is required and must be an object.`);
}

export function createProcessor(project) {
  return {
    artifactInfo() {
      return {
        artifactSetId: project.defaultRuntime.manifest.artifactSetId,
        artifactSetVersion: project.defaultRuntime.manifest.artifactSetVersion,
        flowId: project.defaultRuntime.manifest.flowId,
        flowVersion: project.defaultRuntime.flowInfo.version,
        flows: project.listFlows(),
        diagnostics: project.diagnostics
      };
    },

    init(body) {
      return startProcess(project, body);
    },

    step(state) {
      validateStateShape(state);
      return planStep(project, state);
    },

    execute(state) {
      validateStateShape(state);
      const step = planStep(project, state);
      if (step.type === 'CONTROL') {
        return reduceStep(project, state, step, null);
      }
      if (step.type !== 'PROCESS') {
        throw new HttpError(409, 'Only PROCESS and CONTROL steps can be advanced through /execute.');
      }
      const output = executeStep(project, state, step);
      return reduceStep(project, state, step, output);
    },

    apply(body) {
      assertStepResultBody(body, 'effectResult');
      return applyStepEffect(project, body.state, body.stepId, body.effectResult);
    },

    resume(body) {
      assertStepResultBody(body, 'waitResult');
      return resumeProcess(project, body.state, body.stepId, body.waitResult);
    }
  };
}
