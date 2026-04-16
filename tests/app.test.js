import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareProcessProject } from '../src/project.js';
import { createProcessor } from '../src/processor.js';
import { createApp } from '../src/app.js';
import { createOpenApiDocument } from '../src/openapi.js';

function testConfig(overrides = {}) {
  return {
    artifactDir: path.resolve(process.cwd(), 'artifacts'),
    artifactSetFile: 'artifact-set.v3.json',
    traceMode: 'basic',
    defaultFlowId: 'beneficiary.registration.v3',
    defaultFlowVersion: '1.0.0',
    ...overrides
  };
}

function createReadyRuntime() {
  const project = prepareProcessProject(testConfig());
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
}

function createNotReadyRuntime() {
  return {
    ready: false,
    project: null,
    defaultFlow: {
      flowId: 'beneficiary.registration.v3',
      flowVersion: '1.0.0'
    },
    flows: [],
    diagnostics: ['Artifact manifest not found: /tmp/missing/manifest.json']
  };
}

async function startServer(runtime) {
  const app = createApp(createProcessor(runtime), createOpenApiDocument(), null);
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    baseUrl,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  };
}

function initBody() {
  return {
    processId: 'proc-http-1',
    input: {
      application: {
        beneficiary: {
          type: 'FL_RESIDENT',
          inn: '744404355804'
        }
      },
      currentDate: '2026-04-12'
    }
  };
}

async function postJson(baseUrl, pathName, body) {
  const response = await fetch(`${baseUrl}${pathName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  return { response, payload };
}

test('http facade exposes health, openapi and tombstone execute endpoint', async (t) => {
  const server = await startServer(createReadyRuntime());
  t.after(() => server.close());

  const healthResponse = await fetch(`${server.baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const healthPayload = await healthResponse.json();
  assert.equal(healthPayload.status, 'ready');
  assert.equal(healthPayload.artifactRuntime.defaultFlow.flowId, 'beneficiary.registration.v3');

  const openApiResponse = await fetch(`${server.baseUrl}/openapi.json`);
  assert.equal(openApiResponse.status, 200);
  const openApiDocument = await openApiResponse.json();
  assert.ok(openApiDocument.paths['/run']);
  assert.equal(openApiDocument.paths['/execute'], undefined);

  const docsResponse = await fetch(`${server.baseUrl}/docs`);
  assert.equal(docsResponse.status, 200);

  const executeResponse = await fetch(`${server.baseUrl}/execute`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(executeResponse.status, 410);
  const executePayload = await executeResponse.json();
  assert.equal(executePayload.error.type, 'deprecated_endpoint');
  assert.equal(executePayload.error.code, 'ENDPOINT_DEPRECATED');
});

test('http facade returns wrapped state and blocks runtime calls when not ready', async (t) => {
  const readyServer = await startServer(createReadyRuntime());
  const notReadyServer = await startServer(createNotReadyRuntime());
  t.after(() => Promise.all([readyServer.close(), notReadyServer.close()]));

  const initResponse = await fetch(`${readyServer.baseUrl}/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(initBody())
  });
  assert.equal(initResponse.status, 200);
  const initPayload = await initResponse.json();
  assert.ok(initPayload.state);
  assert.equal(initPayload.state.processId, 'proc-http-1');

  const stepResponse = await fetch(`${readyServer.baseUrl}/step`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: initPayload.state })
  });
  assert.equal(stepResponse.status, 200);
  const stepPayload = await stepResponse.json();
  assert.equal(stepPayload.step.type, 'CONTROL');

  const blockedResponse = await fetch(`${notReadyServer.baseUrl}/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(initBody())
  });
  assert.equal(blockedResponse.status, 503);
  const blockedPayload = await blockedResponse.json();
  assert.equal(blockedPayload.error.type, 'runtime_unavailable');
  assert.equal(blockedPayload.error.code, 'PROJECT_NOT_READY');

  const notReadyHealth = await fetch(`${notReadyServer.baseUrl}/health`);
  assert.equal(notReadyHealth.status, 503);
  const notReadyPayload = await notReadyHealth.json();
  assert.equal(notReadyPayload.status, 'not_ready');
  assert.deepEqual(notReadyPayload.artifactRuntime.diagnostics, ['Artifact manifest not found: /tmp/missing/manifest.json']);
});

test('http facade returns merchant-friendly validation reject result', async (t) => {
  const server = await startServer(createReadyRuntime());
  t.after(() => server.close());

  const invalidInit = {
    processId: 'proc-http-validation-reject',
    input: {
      application: {
        beneficiary: {
          type: 'FL_RESIDENT',
          inn: '744404355804',
          participationId: 'TEST',
          contacts: { phone: '+79801611004', email: 'pa.test.01@example.com' },
          status: { startDate: '2024-01-26' },
          fl: {
            lastName: 'Петров',
            firstName: 'Алексей',
            middleName: 'Анатольевич',
            birthDate: '1979-12-01',
            birthPlace: 'гор. Магнитогорск Челябинской области',
            citizenshipCode: 'RU'
          },
          address: {
            registration: {
              addressLine: '350063, Краснодарский край, г Краснодар, ул им. Пушкина, д 6, кв 20',
              countryCode: 'RU',
              postalCode: '350063',
              regionCode: '23',
              regionName: 'Краснодарский край',
              city: 'Краснодар',
              street: 'им. Пушкина',
              house: '6',
              apartment: '20'
            }
          },
          idDoc: {
            typeCode: '21',
            typeName: 'Паспорт РФ',
            series: '4507',
            number: '360952',
            issueDate: '2030-03-29',
            issuer: 'ГУ МВД РОССИИ ПО Г. МОСКВЕ',
            issuerCode: '770-001',
            isForeignIdDoc: false
          },
          tax: { usTaxResident: false, usResident: false }
        }
      },
      currentDate: '2026-04-12'
    }
  };

  let state = (await postJson(server.baseUrl, '/init', invalidInit)).payload.state;
  state = (await postJson(server.baseUrl, '/route', { state })).payload.state;
  state = (await postJson(server.baseUrl, '/run', { state })).payload.state;
  state = (await postJson(server.baseUrl, '/run', { state })).payload.state;
  state = (await postJson(server.baseUrl, '/run', { state })).payload.state;
  state = (await postJson(server.baseUrl, '/route', { state })).payload.state;
  state = (await postJson(server.baseUrl, '/run', { state })).payload.state;

  assert.equal(state.status, 'FAIL');
  assert.deepEqual(state.result, state.context.facts.terminalResult);
  assert.equal(state.result.outcome, 'VALIDATION_REJECT');
  assert.equal(state.result.reasonCode, 'VALIDATION_ERROR');
  assert.equal(state.result.merchantMessage, 'Заявка отклонена. Есть ошибки');
  assert.equal(state.result.responseMode, 'DETAILED_ERRORS');
  assert.equal(state.result.errors[0].code, 'BEN.IDDOC.ISSUE_DATE.NOT_FUTURE');
  assert.equal(state.result.errors[0].message, 'Дата выдачи документа не должна быть больше текущей даты');
  assert.equal(state.result.errors[0].field, 'beneficiary.idDoc.issueDate');
});


test('flow API returns html app shell and graph data', async (t) => {
  const server = await startServer(createReadyRuntime());
  t.after(() => server.close());

  const flowsPage = await fetch(`${server.baseUrl}/flows`);
  assert.equal(flowsPage.status, 200);
  assert.match(flowsPage.headers.get('content-type') || '', /text\/html/);
  const flowsHtml = await flowsPage.text();
  assert.match(flowsHtml, /<div id="root"><\/div>/);
  assert.match(flowsHtml, /Processor Flows/);
  assert.match(flowsHtml, /\/assets\/graph-.*\.js/);

  const flowPage = await fetch(`${server.baseUrl}/flows/beneficiary.registration.v3?version=1.0.0`);
  assert.equal(flowPage.status, 200);
  assert.match(flowPage.headers.get('content-type') || '', /text\/html/);
  const flowHtml = await flowPage.text();
  assert.match(flowHtml, /<div id="root"><\/div>/);

  const listApi = await fetch(`${server.baseUrl}/api/flows`);
  assert.equal(listApi.status, 200);
  const listPayload = await listApi.json();
  assert.ok(Array.isArray(listPayload.flows));
  assert.ok(listPayload.flows.some((flow) => flow.flowId === 'beneficiary.registration.v3' && flow.name.includes('Регистрация бенефициара')));

  const graphApi = await fetch(`${server.baseUrl}/api/flows/beneficiary.registration.v3?version=1.0.0`);
  assert.equal(graphApi.status, 200);
  const graphPayload = await graphApi.json();
  assert.equal(graphPayload.flowId, 'beneficiary.registration.v3');
  assert.match(graphPayload.name, /Регистрация бенефициара/);
  assert.ok(Array.isArray(graphPayload.nodes));
  assert.ok(Array.isArray(graphPayload.edges));
  assert.ok(graphPayload.nodes.some((node) => node.label === 'Проверка заявки ФЛ-резидента'));
});
