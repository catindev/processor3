import path from 'node:path';

export function readConfig(env = process.env) {
  const artifactDir = env.PROCESSOR_ARTIFACT_DIR || path.resolve(process.cwd(), 'artifacts');
  const artifactSetFile = env.PROCESSOR_ARTIFACT_SET || 'artifact-set.v3.json';
  const traceMode = env.PROCESSOR_TRACE_MODE || 'basic';
  const port = Number(env.PORT || 3000);
  const logDir = env.PROCESSOR_LOG_DIR || path.resolve(process.cwd(), 'processlogs');
  const defaultFlowId = env.PROCESSOR_DEFAULT_FLOW_ID || 'beneficiary.registration.v3';
  const defaultFlowVersion = env.PROCESSOR_DEFAULT_FLOW_VERSION || '';
  return { artifactDir, artifactSetFile, traceMode, port, logDir, defaultFlowId, defaultFlowVersion: defaultFlowVersion || undefined };
}
