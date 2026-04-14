import { prepareProcessProject } from './project.js';

export function bootstrapProcessorRuntime(config) {
  return prepareProcessProject(config);
}
