import express from 'express';
import { HttpError } from './errors.js';

function respond(req, res, fn, next) {
  try {
    const payload = fn();
    res.status(200).json(payload);
  } catch (error) {
    next(error);
  }
}

export function createApp(processor, processLogger = null) {
  const app = express();
  app.locals.processLogger = processLogger;

  app.use(express.json({ limit: '2mb' }));
  if (processLogger) {
    processLogger.attach(app);
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', ...processor.artifactInfo() });
  });

  app.post('/init', (req, res, next) => respond(req, res, () => processor.init(req.body), next));
  app.post('/step', (req, res, next) => respond(req, res, () => processor.step(req.body), next));
  app.post('/execute', (req, res, next) => respond(req, res, () => processor.execute(req.body), next));
  app.post('/apply', (req, res, next) => respond(req, res, () => processor.apply(req.body), next));
  app.post('/resume', (req, res, next) => respond(req, res, () => processor.resume(req.body), next));

  app.use((error, req, res, _next) => {
    if (error instanceof SyntaxError && 'body' in error) {
      const payload = { error: 'Invalid JSON body.' };
      req.app.locals.processLogger?.logError(req, new HttpError(400, payload.error), 400);
      return res.status(400).json(payload);
    }
    const status = error instanceof HttpError ? error.status : 500;
    const payload = { error: error.message || 'Internal server error.' };
    if (error.details) payload.details = error.details;
    req.app.locals.processLogger?.logError(req, error, status);
    return res.status(status).json(payload);
  });

  return app;
}
