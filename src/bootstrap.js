import { prepareProcessProject } from './project.js';

export function bootstrapProcessorRuntime(config) {
  try {
    const project = prepareProcessProject(config);
    return {
      ready: true,
      project,
      defaultFlow: {
        flowId: project.defaultRuntime.flowInfo.id,
        flowVersion: project.defaultRuntime.flowInfo.version
      },
      flows: project.listFlows(),
      diagnostics: project.diagnostics
    };
  } catch (error) {
    return {
      ready: false,
      project: null,
      defaultFlow: {
        flowId: config.defaultFlowId,
        flowVersion: config.defaultFlowVersion ?? null
      },
      flows: [],
      diagnostics: Array.isArray(error?.diagnostics) && error.diagnostics.length
        ? error.diagnostics
        : [error?.message || 'Artifact runtime bootstrap failed.'],
      error
    };
  }
}
