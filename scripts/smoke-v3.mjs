import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapProcessorRuntime } from '../src/bootstrap.js';
import { createProcessor } from '../src/processor.js';
import { createProcessLogger } from '../src/process-logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SAMPLE = {
  beneficiary: {
    type: 'FL_RESIDENT',
    inn: '744404355804',
    participationId: 'TEST-POC-001',
    contacts: { phone: '+79801611004', email: 'test@example.com' },
    status: { startDate: '2024-01-26' },
    fl: {
      lastName: 'Петров',
      firstName: 'Алексей',
      birthDate: '1979-12-01',
      birthPlace: 'гор. Магнитогорск',
      citizenshipCode: 'RU'
    },
    idDoc: {
      typeCode: '21',
      typeName: 'Паспорт гражданина Российской Федерации',
      series: '4510',
      number: '123456',
      issueDate: '2010-05-20',
      issuer: 'ОВД',
      issuerCode: '123-456',
      isForeignIdDoc: false
    },
    address: {
      registration: {
        countryCode: 'RU',
        postalCode: '101000',
        regionCode: '77',
        regionName: 'г Москва',
        city: 'Москва',
        street: 'Тверская',
        house: '1',
        apartment: '1',
        addressLine: 'Москва, Тверская 1'
      }
    },
    tax: { usTaxResident: false, usResident: false, foreignTaxResident: false }
  }
};

function accepted(opId, req) {
  return { requestId: req, result: { accepted: true, requestId: req, operationId: opId } };
}
function successFind(req, found = false) {
  if (found) {
    return { requestId: req, result: { status: 'SUCCESS', payload: { client: { id: 'ABS-CLIENT-001', cardLastModifiedAt: '2026-04-12T00:00:00Z' } } } };
  }
  return { requestId: req, result: { status: 'NOT_FOUND', payload: { code: 'ABS-NOT-FOUND-001', message: 'Клиент не найден' } } };
}
function successCreate(req) {
  return { requestId: req, result: { status: 'SUCCESS', payload: { client: { id: 'ABS-CLIENT-NEW-001' } } } };
}
function successBind(req) {
  return { requestId: req, result: { status: 'SUCCESS', payload: { binding: { id: 'BIND-001' } } } };
}

const project = bootstrapProcessorRuntime({
  artifactDir: path.resolve(__dirname, '../artifacts'),
  artifactSetFile: 'artifact-set.v3.json',
  traceMode: 'basic',
  defaultFlowId: 'beneficiary.registration.v3',
  defaultFlowVersion: '1.0.0'
});
const processor = createProcessor(project);
const processLogger = createProcessLogger({
  logDir: process.env.PROCESSOR_LOG_DIR || path.resolve(__dirname, '../processlogs')
});

function mockReq(action, body) {
  return {
    originalUrl: `/${action}`,
    method: 'POST',
    path: `/${action}`,
    body
  };
}

function call(action, body, invoke) {
  const req = mockReq(action, body);
  try {
    const payload = invoke();
    processLogger.writeEntry(action, req, payload, null, 200);
    return payload;
  } catch (error) {
    processLogger.logError(req, error, 500);
    throw error;
  }
}

let state = call('init', { processId: 'smoke-main', flowId: 'beneficiary.registration.v3', flowVersion: '1.0.0', input: { application: SAMPLE, currentDate: '2026-04-12' } }, () =>
  processor.init({ processId: 'smoke-main', flowId: 'beneficiary.registration.v3', flowVersion: '1.0.0', input: { application: SAMPLE, currentDate: '2026-04-12' } })
).state;
let guard = 0;
while ((state.status === 'ACTIVE' || state.status === 'WAITING') && guard++ < 50) {
  const step = call('step', { state }, () => processor.step({ state })).step;
  if (step.type === 'PROCESS') {
    state = call('run', { state }, () => processor.run({ state })).state;
    continue;
  }
  if (step.type === 'CONTROL') {
    state = call('route', { state }, () => processor.route({ state })).state;
    continue;
  }
  if (step.type === 'EFFECT' && step.subtype === 'CALL') {
    const reqId = 'addr-1';
    state = call('apply', { state, stepId: step.id, effectResult: accepted(step.operationId, reqId) }, () => processor.apply({ state, stepId: step.id, effectResult: accepted(step.operationId, reqId) })).state;
    const wait = call('step', { state }, () => processor.step({ state })).step;
    state = call('resume', { state, stepId: wait.id, waitResult: { requestId: reqId, result: { status: 'SUCCESS', address: { valid: true, normalized: 'Москва, Тверская 1' } } } }, () =>
      processor.resume({ state, stepId: wait.id, waitResult: { requestId: reqId, result: { status: 'SUCCESS', address: { valid: true, normalized: 'Москва, Тверская 1' } } } })
    ).state;
    continue;
  }
  if (step.type === 'EFFECT' && step.subtype === 'SUBFLOW') {
    const reqId = 'sub-1';
    state = call('apply', { state, stepId: step.id, effectResult: accepted(step.operationId, reqId) }, () => processor.apply({ state, stepId: step.id, effectResult: accepted(step.operationId, reqId) })).state;
    const wait = call('step', { state }, () => processor.step({ state })).step;
    state = call('resume', { state, stepId: wait.id, waitResult: { requestId: reqId, result: { status: 'COMPLETE', outcome: 'ABS_ENSURE_BENEFICIARY_DONE' } } }, () =>
      processor.resume({ state, stepId: wait.id, waitResult: { requestId: reqId, result: { status: 'COMPLETE', outcome: 'ABS_ENSURE_BENEFICIARY_DONE' } } })
    ).state;
    continue;
  }
  break;
}
console.log(JSON.stringify({ main: { status: state.status, result: state.result } }, null, 2));

let sub = call('init', { processId: 'smoke-sub', flowId: 'abs.ensure_fl_resident_beneficiary', flowVersion: '1.0.0', input: { application: SAMPLE, currentDate: '2026-04-12' } }, () =>
  processor.init({ processId: 'smoke-sub', flowId: 'abs.ensure_fl_resident_beneficiary', flowVersion: '1.0.0', input: { application: SAMPLE, currentDate: '2026-04-12' } })
).state;
guard = 0;
while ((sub.status === 'ACTIVE' || sub.status === 'WAITING') && guard++ < 50) {
  const step = call('step', { state: sub }, () => processor.step({ state: sub })).step;
  if (step.type === 'PROCESS') {
    sub = call('run', { state: sub }, () => processor.run({ state: sub })).state;
    continue;
  }
  if (step.type === 'CONTROL') {
    sub = call('route', { state: sub }, () => processor.route({ state: sub })).state;
    continue;
  }
  if (step.id === 'send_find_client') {
    sub = call('apply', { state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'find-1') }, () => processor.apply({ state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'find-1') })).state;
    const wait = call('step', { state: sub }, () => processor.step({ state: sub })).step;
    sub = call('resume', { state: sub, stepId: wait.id, waitResult: successFind('find-1', false) }, () => processor.resume({ state: sub, stepId: wait.id, waitResult: successFind('find-1', false) })).state;
    continue;
  }
  if (step.id === 'send_create_client') {
    sub = call('apply', { state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'create-1') }, () => processor.apply({ state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'create-1') })).state;
    const wait = call('step', { state: sub }, () => processor.step({ state: sub })).step;
    sub = call('resume', { state: sub, stepId: wait.id, waitResult: successCreate('create-1') }, () => processor.resume({ state: sub, stepId: wait.id, waitResult: successCreate('create-1') })).state;
    continue;
  }
  if (step.id === 'send_bind_client') {
    sub = call('apply', { state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'bind-1') }, () => processor.apply({ state: sub, stepId: step.id, effectResult: accepted(step.operationId, 'bind-1') })).state;
    const wait = call('step', { state: sub }, () => processor.step({ state: sub })).step;
    sub = call('resume', { state: sub, stepId: wait.id, waitResult: successBind('bind-1') }, () => processor.resume({ state: sub, stepId: wait.id, waitResult: successBind('bind-1') })).state;
    continue;
  }
  break;
}
console.log(JSON.stringify({ subflow: { status: sub.status, result: sub.result } }, null, 2));
console.log(`process logs dir=${processLogger.baseDir}`);
