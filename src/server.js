import { readConfig } from './config.js';
import { bootstrapProcessorRuntime } from './bootstrap.js';
import { createProcessor } from './processor.js';
import { createApp } from './app.js';
import { createProcessLogger } from './process-logger.js';

const config = readConfig(process.env);
const runtime = bootstrapProcessorRuntime(config);
const processor = createProcessor(runtime);
const processLogger = createProcessLogger(config);
const app = createApp(processor, processLogger);

app.listen(config.port, () => {
  console.log(`beneficiary-processor-v3 listening on ${config.port}`);
  const defaultRuntime = runtime.defaultRuntime;
  console.log(`artifactSetId=${defaultRuntime.manifest.artifactSetId} artifactSetVersion=${defaultRuntime.manifest.artifactSetVersion}`);
  console.log(`process logs dir=${processLogger.baseDir}`);
});
