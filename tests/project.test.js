import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareProcessProject } from '../src/project.js';
import { createProcessor } from '../src/processor.js';

function testConfig() {
  return {
    artifactDir: path.resolve(process.cwd(), 'artifacts'),
    artifactSetFile: 'artifact-set.v3.json',
    traceMode: 'basic',
    defaultFlowId: 'beneficiary.registration.v3',
    defaultFlowVersion: '1.0.0'
  };
}

test('prepareProcessProject loads version-aware runtimes and subflow target', () => {
  const project = prepareProcessProject(testConfig());
  const main = project.getRuntime('beneficiary.registration.v3', '1.0.0');
  const sub = project.getRuntime('abs.ensure_fl_resident_beneficiary', '1.0.0');
  assert.equal(main.flowInfo.id, 'beneficiary.registration.v3');
  assert.equal(sub.flowInfo.id, 'abs.ensure_fl_resident_beneficiary');
  assert.ok(project.listFlows().some((flow) => flow.flowId === 'abs.ensure_fl_resident_beneficiary' && flow.flowVersion === '1.0.0'));
});

test('processor init returns explicit flow version and execute advances control/process canonically', () => {
  const project = prepareProcessProject(testConfig());
  const processor = createProcessor(project);
  const initial = processor.init({
    processId: 'proc-1',
    flowId: 'beneficiary.registration.v3',
    flowVersion: '1.0.0',
    application: {
      payload: {
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
            typeCode: '21', typeName: 'Паспорт РФ', series: '4507', number: '360952', issueDate: '2004-03-29', issuer: 'ГУ МВД РОССИИ ПО Г. МОСКВЕ', issuerCode: '770-001', isForeignIdDoc: false
          },
          tax: { usTaxResident: false, usResident: false }
        }
      },
      context: { currentDate: '2026-04-12' }
    }
  });
  assert.equal(initial.version, '1.0.0');
  const planned = processor.step(initial);
  assert.equal(planned.type, 'CONTROL');
  const afterRoute = processor.execute(initial);
  assert.equal(afterRoute.currentStepId, 'validate_fl_resident_request');
});
