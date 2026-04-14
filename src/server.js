import { readConfig } from './config.js';
import { bootstrapProcessorRuntime } from './bootstrap.js';
import { createProcessor } from './processor.js';
import { createApp } from './app.js';
import { createProcessLogger } from './process-logger.js';
import { createOpenApiDocument } from './openapi.js';

const config = readConfig(process.env);
const runtime = bootstrapProcessorRuntime(config);
const processor = createProcessor(runtime);
const processLogger = createProcessLogger(config);
const openApiDocument = createOpenApiDocument();
const app = createApp(processor, openApiDocument, processLogger);

app.listen(config.port, () => {
  console.log(`beneficiary-processor-v3 listening on ${config.port}`);
  console.log(`swagger docs: http://localhost:${config.port}/docs`);
  console.log(`openapi json: http://localhost:${config.port}/openapi.json`);
  console.log(`process logs dir=${processLogger.baseDir}`);
  if (runtime.ready) {
    console.log(`artifact runtime status=ready defaultFlow=${runtime.defaultFlow.flowId}@${runtime.defaultFlow.flowVersion}`);
  } else {
    console.error('artifact runtime status=not_ready');
    for (const diagnostic of runtime.diagnostics) {
      console.error(`diagnostic: ${diagnostic}`);
    }
  }
});
