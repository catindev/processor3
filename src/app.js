import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { HttpError, errorPayload } from './errors.js';

function respond(res, fn, next) {
  try {
    const payload = fn();
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

export function createApp(processor, openApiDocument, processLogger = null) {
  const app = express();
  app.locals.processLogger = processLogger;

  app.use(express.json({ limit: '2mb' }));
  if (processLogger) {
    processLogger.attach(app);
  }

  app.get('/health', (_req, res) => {
    const health = processor.health();
    res.status(health.statusCode).json(health.body);
  });

  app.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    explorer: true,
    customSiteTitle: 'Processor3 API'
  }));

  app.post('/init', (req, res, next) => respond(res, () => processor.init(req.body), next));
  app.post('/step', (req, res, next) => respond(res, () => processor.step(req.body), next));
  app.post('/run', (req, res, next) => respond(res, () => processor.run(req.body), next));
  app.post('/route', (req, res, next) => respond(res, () => processor.route(req.body), next));
  app.post('/apply', (req, res, next) => respond(res, () => processor.apply(req.body), next));
  app.post('/resume', (req, res, next) => respond(res, () => processor.resume(req.body), next));
  app.post('/execute', (req, res, next) => respond(res, () => processor.execute(req.body), next));

  app.use((error, req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      const payload = errorPayload(new HttpError(400, 'request_error', 'INVALID_JSON', 'Invalid JSON body.'));
      req.app.locals.processLogger?.logError(req, payload.error, 400);
      return res.status(400).json(payload);
    }
    const status = error instanceof HttpError ? error.status : 500;
    const payload = errorPayload(error);
    req.app.locals.processLogger?.logError(req, payload.error, status);
    return res.status(status).json(payload);
  });

  return app;
}
