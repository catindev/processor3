import fs from 'node:fs';
import path from 'node:path';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function nowStamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, '-');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function russianActionDescription(action, entry) {
  const stepId = entry.stepId ? ` Шаг: ${entry.stepId}.` : '';
  switch (action) {
    case 'init': return `Инициализация процесса.${stepId}`;
    case 'step': return `Планирование текущего активного шага.${stepId}`;
    case 'execute': return `Исполнение PROCESS или CONTROL шага процессора.${stepId}`;
    case 'apply': return `Применение результата EFFECT шага и перевод процесса в следующее состояние.${stepId}`;
    case 'resume': return `Продолжение процесса по WAIT шагу после внешнего результата.${stepId}`;
    case 'error': return `Во время обработки запроса возникла ошибка.${stepId}`;
    case 'html_build_error': return `При сборке итогового HTML-лога возникла техническая ошибка.${stepId}`;
    default: return `Техническое действие над процессом: ${action}.${stepId}`;
  }
}

function extractStateLike(entry) {
  const candidates = [entry?.response, entry?.request?.body?.state, entry?.request?.body];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === 'object' && typeof candidate.processId === 'string' && typeof candidate.id === 'string' && typeof candidate.version === 'string') {
      return candidate;
    }
  }
  return null;
}

function summarizeProcess(entries, processId) {
  const stateCandidates = entries
    .map(({ entry }) => extractStateLike(entry))
    .filter(Boolean);
  const firstState = stateCandidates[0] || null;
  const lastState = stateCandidates.at(-1) || null;
  return {
    processId,
    flowId: lastState?.id || firstState?.id || 'n/a',
    flowVersion: lastState?.version || firstState?.version || 'n/a',
    traceMode: lastState?.traceMode || firstState?.traceMode || 'n/a',
    status: lastState?.status || 'n/a',
    currentStepId: lastState?.currentStepId || 'n/a',
    currentStepType: lastState?.currentStepType || 'n/a',
    currentStepSubtype: lastState?.currentStepSubtype || 'n/a'
  };
}

export function createProcessLogger(config) {
  const baseDir = path.resolve(config.logDir || path.resolve(process.cwd(), 'processlogs'));
  ensureDir(baseDir);

  function getProcessId(req, responsePayload) {
    if (req.body?.processId) return String(req.body.processId);
    if (req.body?.state?.processId) return String(req.body.state.processId);
    if (responsePayload?.processId) return String(responsePayload.processId);
    return null;
  }

  function getStepId(req, responsePayload) {
    return req.body?.stepId || responsePayload?.id || responsePayload?.currentStepId || null;
  }

  function processDir(processId) {
    const dir = path.join(baseDir, processId);
    ensureDir(dir);
    return dir;
  }

  function writeJson(filePath, payload) {
    fs.writeFileSync(filePath, `${JSON.stringify(safeJson(payload), null, 2)}\n`, 'utf8');
  }

  function buildHtml(processId) {
    const dir = processDir(processId);
    const files = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json') && !name.startsWith(`${processId}.state.`) && name !== `${processId}.summary.json`)
      .sort();
    const entries = files
      .map((name) => ({
        name,
        entry: JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      }))
      .filter(({ entry }) => entry && typeof entry === 'object' && typeof entry.action === 'string');

    const summary = summarizeProcess(entries, processId);
    writeJson(path.join(dir, `${processId}.summary.json`), summary);

    const parts = [];
    parts.push('<!doctype html><html lang="ru"><head><meta charset="utf-8">');
    parts.push(`<title>Лог процесса ${escapeHtml(processId)}</title>`);
    parts.push('<style>body{font-family:Arial,sans-serif;margin:24px;line-height:1.45}h1,h2{margin:0 0 12px}section{border:1px solid #ddd;border-radius:8px;padding:16px;margin:12px 0}pre{background:#f7f7f7;padding:12px;overflow:auto;border-radius:6px;white-space:pre-wrap}code{font-family:Consolas,monospace}.meta{color:#555}.header{background:#fafafa}.kv{margin:4px 0}</style></head><body>');
    parts.push(`<h1>Лог обработки процесса ${escapeHtml(processId)}</h1>`);
    parts.push('<section class="header">');
    parts.push('<h2>Паспорт процесса</h2>');
    parts.push(`<div class="kv"><strong>processId:</strong> ${escapeHtml(summary.processId)}</div>`);
    parts.push(`<div class="kv"><strong>flowId:</strong> ${escapeHtml(summary.flowId)}</div>`);
    parts.push(`<div class="kv"><strong>flowVersion:</strong> ${escapeHtml(summary.flowVersion)}</div>`);
    parts.push(`<div class="kv"><strong>traceMode:</strong> ${escapeHtml(summary.traceMode)}</div>`);
    parts.push(`<div class="kv"><strong>Итоговый статус:</strong> ${escapeHtml(summary.status)}</div>`);
    parts.push(`<div class="kv"><strong>Последний активный шаг:</strong> ${escapeHtml(summary.currentStepId)} (${escapeHtml(summary.currentStepType)} / ${escapeHtml(summary.currentStepSubtype)})</div>`);
    parts.push('</section>');
    parts.push('<p class="meta">Документ собран автоматически из JSON-следов Processor v3.</p>');

    for (const { name, entry } of entries) {
      parts.push('<section>');
      parts.push(`<h2>${escapeHtml(String(entry.action).toUpperCase())}</h2>`);
      parts.push(`<p>${escapeHtml(russianActionDescription(entry.action, entry))}</p>`);
      parts.push(`<p class="meta">Файл: ${escapeHtml(name)} · Время: ${escapeHtml(entry.timestamp || 'n/a')}${entry.httpStatus ? ` · HTTP ${escapeHtml(entry.httpStatus)}` : ''}</p>`);
      if (entry.request?.body != null) {
        parts.push('<h3>Входной запрос</h3>');
        parts.push(`<pre><code>${escapeHtml(JSON.stringify(entry.request.body, null, 2))}</code></pre>`);
      }
      if (entry.response != null) {
        parts.push('<h3>Ответ / результат действия</h3>');
        parts.push(`<pre><code>${escapeHtml(JSON.stringify(entry.response, null, 2))}</code></pre>`);
      }
      if (entry.error != null) {
        parts.push('<h3>Ошибка</h3>');
        parts.push(`<pre><code>${escapeHtml(JSON.stringify(entry.error, null, 2))}</code></pre>`);
      }
      parts.push('</section>');
    }
    parts.push('</body></html>');
    fs.writeFileSync(path.join(dir, `${processId}.log.html`), parts.join(''), 'utf8');
  }

  function writeEntry(action, req, responsePayload, errorPayload = null, httpStatus = null) {
    const processId = getProcessId(req, responsePayload);
    if (!processId) return;
    const dir = processDir(processId);
    const timestamp = new Date().toISOString();
    const stepId = getStepId(req, responsePayload);
    const entry = {
      action,
      timestamp,
      processId,
      stepId,
      path: req.originalUrl,
      method: req.method,
      httpStatus,
      request: { body: safeJson(req.body) },
      response: responsePayload != null ? safeJson(responsePayload) : null,
      error: errorPayload != null ? safeJson(errorPayload) : null
    };
    const fileName = `${nowStamp()}-${action}.json`;
    writeJson(path.join(dir, fileName), entry);
    const stateLike = extractStateLike(entry);
    if (stateLike) {
      writeJson(path.join(dir, `${processId}.state.latest.json`), stateLike);
      if (action === 'init') {
        writeJson(path.join(dir, `${processId}.state.init.json`), stateLike);
      }
    }
    const finalState = responsePayload && typeof responsePayload === 'object' && responsePayload.status && ['COMPLETE', 'FAIL'].includes(responsePayload.status);
    if (finalState || errorPayload) {
      try {
        buildHtml(processId);
      } catch (buildError) {
        writeJson(path.join(dir, `${nowStamp()}-html-build-error.json`), {
          action: 'html_build_error',
          timestamp,
          processId,
          stepId,
          path: req.originalUrl,
          method: req.method,
          httpStatus,
          request: { body: safeJson(req.body) },
          response: responsePayload != null ? safeJson(responsePayload) : null,
          error: {
            message: buildError.message,
            stack: buildError.stack ?? null
          }
        });
      }
    }
  }

  function attach(app) {
    app.use((req, res, next) => {
      if (!['/init', '/step', '/execute', '/apply', '/resume'].includes(req.path)) return next();
      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        const action = req.path.slice(1);
        writeEntry(action, req, payload, null, res.statusCode);
        return originalJson(payload);
      };
      next();
    });
  }

  function logError(req, error, status) {
    writeEntry('error', req, null, { message: error.message, details: error.details ?? null }, status);
  }

  return { attach, logError, writeEntry, baseDir };
}
