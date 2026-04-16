import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerUi from 'swagger-ui-express';
import { HttpError, errorPayload } from './errors.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uiDistDir = path.resolve(__dirname, '../ui-dist');
const uiHtmlPath = path.join(uiDistDir, 'graph.html');

function respond(res, fn, next) {
  Promise.resolve()
    .then(() => fn())
    .then((payload) => {
      res.status(200).json(payload);
    })
    .catch((error) => {
      next(error);
    });
}

function sendUiShell(res) {
  if (!fs.existsSync(uiHtmlPath)) {
    return res.status(500).type('html').send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>UI not built</title></head><body style="font-family:system-ui;padding:24px"><h1>UI не собран</h1><p>Выполните <code>npm run build:ui</code>, затем перезапустите сервис.</p></body></html>`);
  }
  return res.type('html').sendFile(uiHtmlPath);
}

export function createApp(processor, openApiDocument, processLogger = null) {
  const app = express();
  app.locals.processLogger = processLogger;

  app.use(express.json({ limit: '2mb' }));
  if (processLogger) processLogger.attach(app);

  if (fs.existsSync(uiDistDir)) {
    app.use('/assets', express.static(path.join(uiDistDir, 'assets'), { fallthrough: true }));
  }

  app.get('/health', (_req, res) => {
    const health = processor.health();
    res.status(health.statusCode).json(health.body);
  });

  app.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument, { explorer: true, customSiteTitle: 'Processor3 API' }));

  app.get('/api/flows', (req, res, next) => respond(res, () => processor.listFlows(), next));
  app.get('/api/flows/:flowId', (req, res, next) => respond(res, () => processor.describeFlow(req.params.flowId, req.query.version), next));

  app.get('/flows', (_req, res) => sendUiShell(res));
  app.get('/flows/:flowId', (_req, res) => sendUiShell(res));

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
