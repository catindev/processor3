import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareProcessProject } from '../src/project.js';
import { createProcessor } from '../src/processor.js';

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

function createRuntime() {
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

function initCommand() {
  return {
    processId: 'proc-1',
    flowId: 'beneficiary.registration.v3',
    flowVersion: '1.0.0',
    input: {
      application: {
        beneficiary: {
          type: 'FL_RESIDENT',
          inn: '744404355804',
          participationId: 'TEST-536779508951',
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
            issueDate: '2004-03-29',
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
}

function createValidBeneficiary() {
  return {
    type: 'FL_RESIDENT',
    inn: '744404355804',
    participationId: 'TEST-536779508951',
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
      issueDate: '2004-03-29',
      issuer: 'ГУ МВД РОССИИ ПО Г. МОСКВЕ',
      issuerCode: '770-001',
      isForeignIdDoc: false
    },
    tax: { usTaxResident: false, usResident: false }
  };
}

function advanceUntilTerminal(processor, initialState, maxSteps = 10) {
  let state = initialState;
  for (let i = 0; i < maxSteps; i += 1) {
    if (state.status === 'COMPLETE' || state.status === 'FAIL') return state;
    const step = processor.step({ state }).step;
    if (step.type === 'CONTROL') {
      state = processor.route({ state }).state;
      continue;
    }
    if (step.type === 'PROCESS') {
      state = processor.run({ state }).state;
      continue;
    }
    return state;
  }
  return state;
}

test('prepareProcessProject loads version-aware runtimes and subflow target', () => {
  const project = prepareProcessProject(testConfig());
  const main = project.getRuntime('beneficiary.registration.v3', '1.0.0');
  const sub = project.getRuntime('abs.ensure_fl_resident_beneficiary', '1.0.0');
  assert.equal(main.flowInfo.id, 'beneficiary.registration.v3');
  assert.equal(sub.flowInfo.id, 'abs.ensure_fl_resident_beneficiary');
  assert.ok(project.listFlows().some((flow) => flow.flowId === 'abs.ensure_fl_resident_beneficiary' && flow.flowVersion === '1.0.0'));
});

test('processor uses wrapped responses and separates /route from /run', () => {
  const processor = createProcessor(createRuntime());
  const initialized = processor.init(initCommand());
  assert.equal(initialized.state.version, '1.0.0');

  const plannedControl = processor.step({ state: initialized.state });
  assert.equal(plannedControl.step.type, 'CONTROL');
  assert.equal(plannedControl.step.id, 'route_by_supported_scenario');

  assert.throws(() => processor.run({ state: initialized.state }), (error) => {
    assert.equal(error.code, 'STEP_TYPE_INVALID');
    assert.equal(error.type, 'runtime_error');
    return true;
  });

  const afterRoute = processor.route({ state: initialized.state });
  assert.equal(afterRoute.state.currentStepId, 'validate_fl_resident_request');

  const plannedProcess = processor.step({ state: afterRoute.state });
  assert.equal(plannedProcess.step.type, 'PROCESS');
  assert.equal(plannedProcess.step.id, 'validate_fl_resident_request');

  const afterRun = processor.run({ state: afterRoute.state });
  assert.equal(afterRun.state.currentStepId, 'derive_validation_facts');
});

test('processor returns merchant-friendly validation reject result', () => {
  const processor = createProcessor(createRuntime());
  const beneficiary = createValidBeneficiary();
  beneficiary.idDoc.issueDate = '2030-03-29';

  const terminal = advanceUntilTerminal(processor, processor.init({
    processId: 'proc-validation-reject',
    flowId: 'beneficiary.registration.v3',
    flowVersion: '1.0.0',
    input: {
      application: { beneficiary },
      currentDate: '2026-04-12'
    }
  }).state);

  assert.equal(terminal.status, 'FAIL');
  assert.deepEqual(terminal.result, terminal.context.facts.terminalResult);
  assert.equal(terminal.result.outcome, 'VALIDATION_REJECT');
  assert.equal(terminal.result.reasonCode, 'VALIDATION_ERROR');
  assert.equal(terminal.result.merchantMessage, 'Заявка отклонена. Есть ошибки');
  assert.equal(terminal.result.responseMode, 'DETAILED_ERRORS');
  assert.ok(Array.isArray(terminal.result.errors));
  assert.ok(terminal.result.errors.length > 0);
  assert.equal(terminal.result.errors[0].code, 'BEN.IDDOC.ISSUE_DATE.NOT_FUTURE');
  assert.equal(terminal.result.errors[0].message, 'Дата выдачи документа не должна быть больше текущей даты');
  assert.equal(terminal.result.errors[0].field, 'beneficiary.idDoc.issueDate');
});

test('processor returns generalized compliance reject result', () => {
  const processor = createProcessor(createRuntime());
  const beneficiary = createValidBeneficiary();
  beneficiary.fl.citizenshipCode = '';

  const terminal = advanceUntilTerminal(processor, processor.init({
    processId: 'proc-compliance-reject',
    flowId: 'beneficiary.registration.v3',
    flowVersion: '1.0.0',
    input: {
      application: { beneficiary },
      currentDate: '2026-04-12'
    }
  }).state);

  assert.equal(terminal.status, 'FAIL');
  assert.equal(terminal.context.facts.terminalResult, undefined);
  assert.equal(terminal.result.outcome, 'COMPLIANCE_REJECT');
  assert.equal(terminal.result.reasonCode, 'REGULATORY_REJECT');
  assert.equal(terminal.result.merchantMessage, 'Заявка отклонена по регуляторной причине');
  assert.equal(terminal.result.responseMode, 'GENERALIZED_ERROR');
  assert.deepEqual(terminal.result.errors, []);
});
