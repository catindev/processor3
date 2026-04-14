import fs from 'fs';
import { bootstrapProcessorRuntime } from "../src/bootstrap.js";
import { createProcessor } from "../src/processor.js";
const registry = bootstrapProcessorRuntime({ artifactDir: new URL('../artifacts', import.meta.url).pathname, artifactSetFile: 'artifact-set.v3.json', traceMode: 'basic', defaultFlowId: 'beneficiary.registration.v3' });
const processor = createProcessor(registry);
const pos = JSON.parse(fs.readFileSync(new URL('../../rules/samples/FV-POS-01.json', import.meta.url), 'utf8'));
const neg = JSON.parse(fs.readFileSync(new URL('../../rules/samples/FV-NEG-01.json', import.meta.url), 'utf8'));
function accepted(opId, req){return {requestId:req, result:{accepted:true, requestId:req, operationId:opId}};}
function run(sample, processId){
  let state = processor.init({ processId, flowId:'beneficiary.registration.v3', application:{payload:sample.payload, context:{currentDate:sample.context.currentDate}}});
  let guard=0;
  while((state.status==='ACTIVE' || state.status==='WAITING') && guard++<50){
    const step=processor.step(state);
    if(step.type==='PROCESS' || step.type==='CONTROL'){ state=processor.execute(state); continue; }
    if(step.id==='validate_registration_address'){
      state=processor.apply({state, stepId:step.id, effectResult:accepted(step.operationId,'addr-1')});
      const wait=processor.step(state);
      state=processor.resume({state, stepId:wait.id, waitResult:{requestId:'addr-1', result:{status:'SUCCESS', address:{valid:true, normalized:{country:'RU'}}}}});
      continue;
    }
    if(step.type==='EFFECT' && step.subtype==='SUBFLOW'){
      state=processor.apply({state, stepId:step.id, effectResult:accepted(step.operationId,'sub-1')});
      const wait=processor.step(state);
      state=processor.resume({state, stepId:wait.id, waitResult:{requestId:'sub-1', result:{childStatus:'COMPLETE', childResult:{status:'COMPLETE', outcome:'ABS_ENSURE_BENEFICIARY_DONE'}}}});
      continue;
    }
    break;
  }
  return state;
}
console.log(JSON.stringify({positive:run(pos,'fixture-pos'), negative:run(neg,'fixture-neg')}, null, 2));
