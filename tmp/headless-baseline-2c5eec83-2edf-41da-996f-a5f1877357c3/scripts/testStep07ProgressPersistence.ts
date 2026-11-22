import assert from 'node:assert/strict';
import ts from 'typescript';
import {evaluateExpression} from './helpers/uiContractHarness';
import {readFileSync} from 'node:fs';
import {runStep07AutoRepair,type Step07RepairOptions} from '../src/services/step07AutoRepairService';
import {readStep07Checkpoint,resolveStep07CheckpointContext,step07CheckpointKey,writeStep07Checkpoint,step07UnitKey} from '../src/services/step07CheckpointService';
import {hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {resolveATPUnitMappingReadiness,countStep07CompletedUnits} from '../src/services/atpMappingReadinessService';
import {sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {saveStorageV5,loadStorageV5,saveATPUnitMappingV5,getATPUnitMappingV5} from '../src/services/storageV5';
import {readStep07Diagnostics} from '../src/services/step07DiagnosticsService';
import type {ATPData,TPData,ATPUnitMappingData,Step07AutoRequest,Step07SemanticCheck} from '../src/types';
import type {MappingAnalysisResult} from '../src/services/aiService';
const raw=JSON.parse(readFileSync('scripts/fixtures/pjokClass6MappingDiagnostic.json','utf8'));
const memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
const locked=new Set<string>();
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(key:string,options:{ifAvailable?:boolean;signal?:AbortSignal},fn:(lock:unknown)=>Promise<unknown>)=>{if(locked.has(key)&&options.ifAvailable)return fn(null);while(locked.has(key)){if(options.signal?.aborted)throw Error('Aborted');await new Promise(r=>setTimeout(r,1));}locked.add(key);try{return await fn({name:key});}finally{locked.delete(key);}}}});
function seed(){
  memory.clear();const state=createReadyV21WorkflowFixture();
  const tp:TPData={id:'tp',academicSettingId:'y',workflowStatus:'SIAP',updatedAt:'2026-11-09',items:structuredClone(raw.tp)};
  const atp:ATPData={id:'atp',academicSettingId:'y',tpDataId:'tp',workflowStatus:'SIAP',updatedAt:tp.updatedAt,items:structuredClone(raw.atp)};
  const mapping:ATPUnitMappingData={id:'map',academicSettingId:'y',tpDataId:'tp',atpId:'atp',updatedAt:tp.updatedAt,units:structuredClone(raw.units)};
  state.annualData.tp=[{yearPlanId:'y',value:tp}];state.annualData.atp=[{yearPlanId:'y',value:atp}];state.annualData.atpUnitMappings=[{yearPlanId:'y',value:mapping}];saveStorageV5(state);
  return {mapping,atp,tp};
}
type Fixture=ReturnType<typeof seed>;
function provider(f:Fixture,calls:Step07AutoRequest[]=[]):Step07RepairOptions['analyze']{return async(mapping,request)=>{
  calls.push(structuredClone(request));
  if(!request.execution?.reconciliation){assert.equal(mapping.units.length,1);assert.equal(mapping.units[0].id,request.execution!.activeUnitId);assert.equal(request.execution!.otherUnits.length,8);}
  if(request.phase==='VERIFY'){
    const checks:Step07SemanticCheck[]=(request.actions || []).map(a=>({actionId:a.id,verdict:'SUPPORTED',reason:'Simulated pedagogical verifier: planned competence is explicit, original movement/health context retained, source quotes exact.',missingEvidence:[],targetUnitQuote:mapping.units.find(u=>u.id===a.targetUnitId)!.title,evidence:a.linkedTpIds.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:a.before!,competenceQuote:f.tp.items.find(t=>t.id===id)!.competence.split(',')[0].trim(),contextQuote:a.before!}))}));
    return {summary:{} as any,atpFindings:[],materialFindings:[],step07SemanticChecks:checks};
  }
  const actions:AlignmentAction[]=mapping.units.flatMap(u=>u.materials.filter(m=>!hasTeacherMaterialSupport(u,m,f.tp)).map(m=>{
    const original=raw.units.find((v:any)=>v.order===u.order),old=original.materials.find((v:any)=>v.order===m.order);
    const ids=m.linkedTpIds.length?m.linkedTpIds:old.linkedTpIds.length?old.linkedTpIds:original.linkedTpIds.length?[original.linkedTpIds[0]]:[f.tp.items[1].id];
    return {id:'repair-'+m.id,type:'EDIT_MATERIAL',targetUnitId:u.id,targetMaterialId:m.id,before:m.title,after:m.title+' — '+ids.map((id:string)=>{const t=f.tp.items.find(t=>t.id===id)!;return t.competence.split(',')[0].trim()+' '+t.contentScope;}).join('; '),linkedTpIds:ids,reason:'Simulated planned activity explicitly develops canonical competence while preserving the original material context.',evidence:ids.map((id:string)=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:m.title}))};
  }));
  return sanitizeMappingAnalysisResult({alignmentProposals:actions},{currentMapping:mapping,atpData:f.atp,tpData:f.tp,step07Auto:request});
};}
function options(f:Fixture,extra:Partial<Step07RepairOptions>={}):Step07RepairOptions {const mapping=getATPUnitMappingV5('y')!;return {...f,mapping,persistedMapping:mapping,checkpointContext:resolveStep07CheckpointContext('y'),analyze:provider(f),save:m=>{saveATPUnitMappingV5('y',m);return true;},isCurrent:()=>true,...extra};}

const f=seed();const done=await runStep07AutoRepair(options(f));assert(done.saved,done.issues.join(';'));
const four=structuredClone(done.mapping);four.step07AutoRepair!.outcome='INCOMPLETE';four.step07AutoRepair!.verifiedFingerprint=undefined;
for(const u of four.units.slice(4)){u.linkedTpIds=[];u.linkedAtpItemIds=[];for(const m of u.materials){m.linkedTpIds=[];m.linkedAtpItemIds=[];}}
const state=loadStorageV5();state.annualData.atpUnitMappings![0].value=four;saveStorageV5(state);
// Remove only this fixture's earlier completed checkpoint to start from the saved four-Bab source.
memory.delete(step07CheckpointKey(resolveStep07CheckpointContext('y')));
const valid=(m:ATPUnitMappingData)=>{const r=resolveATPUnitMappingReadiness(m,f.atp,f.tp,undefined,{evaluateRepair:true});return m.units.filter(u=>!r.repairIssues!.some(i=>i.unitId===u.id)).length;};
assert.equal(valid(four),4);
let proposals=0;const base=provider(f),work:any[]=[];
const first=await runStep07AutoRepair(options(f,{onWork:w=>work.push(w),analyze:async(m,r,s)=>{if(r.phase==='PROPOSE'&&++proposals>2)throw Error('API_FAILURE: fixture interrupted after two valid Bab');return base(m,r,s);}}));
console.log('FIRST',JSON.stringify({valid:valid(first.mapping),stored:valid(getATPUnitMappingV5('y')!),persisted:first.persisted,work:work.at(-1),cp:Object.values(readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.units).filter(p=>p.status==='DONE').length}));
assert.equal(valid(getATPUnitMappingV5('y')!),6);
assert(first.persisted,'Earlier Bab saves must remain reported as persisted after later API failure');
const six=structuredClone(getATPUnitMappingV5('y')!);
const again=await runStep07AutoRepair(options(f,{analyze:async()=>{throw Error('API_FAILURE: retry unavailable');}}));
console.log('AGAIN',JSON.stringify({valid:valid(again.mapping),stored:valid(getATPUnitMappingV5('y')!),persisted:again.persisted,cp:Object.values(readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.units).filter(p=>p.status==='DONE').length}));
assert(valid(again.mapping)>=6);assert(valid(getATPUnitMappingV5('y')!)>=6);
const legacy=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;delete legacy.workingMapping;writeStep07Checkpoint(legacy);
const stale=await runStep07AutoRepair(options(f,{mapping:four,persistedMapping:four,analyze:async()=>{throw Error('API_FAILURE: stale render retry');}}));
console.log('STALE_INPUT',JSON.stringify({valid:valid(stale.mapping),stored:valid(getATPUnitMappingV5('y')!),persisted:stale.persisted}));
assert(valid(stale.mapping)>=6,'A stale UI draft must never replace the six saved valid Bab');
assert(stale.persisted);assert.deepEqual(stale.mapping.units,six.units);
console.log('PASS 1: actual PJOK 9/27 fixture: 4 -> 6 -> retry/reload/stale draft -> 6, V5 and proof retained');

const buffered=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;
buffered.workingMapping=structuredClone(six);
for(const unit of buffered.workingMapping.units.filter(u=>JSON.stringify(u)!==JSON.stringify(four.units.find(v=>v.id===u.id)))){
  const original=six.units.find(u=>u.id===unit.id)!;
  unit.actionHistory=[];for(const material of unit.materials)material.titleHistory=[];
  Object.assign(buffered.units[unit.id],{source:step07UnitKey(unit),baseSource:step07UnitKey(original),status:'RUNNING'});
}
writeStep07Checkpoint(buffered);
const bufferedRetry=await runStep07AutoRepair(options(f,{analyze:async()=>{throw Error('API_FAILURE: stale history buffer');}}));
assert.equal(valid(bufferedRetry.mapping),6);assert.deepEqual(getATPUnitMappingV5('y')!.units,six.units);
console.log('PASS checkpoint: a same-graph buffer missing semantic history cannot replace valid saved Bab');

// Execute the actual React sync callback: an old prop must not undo V5 progress.
const uiFile='src/components/ATPUnitMappingManager.tsx';
const ast=ts.createSourceFile(uiFile,readFileSync(uiFile,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let syncExpression='';
function visit(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='useEffect'&&node.arguments[0]?.getText(ast).includes('setUnits(createInitialUnits(source'))syncExpression=node.arguments[0].getText(ast);ts.forEachChild(node,visit);}
visit(ast);assert(syncExpression);
let visible:ATPUnitMappingData['units']=[],writes=0;
const sync=(hasChanges:boolean,isAnalyzing:boolean)=>evaluateExpression(syncExpression,{mapping:four,atp:f.atp,hasChanges,isAnalyzing,getATPUnitMappingV5,createInitialUnits:(m:ATPUnitMappingData)=>m.units,setUnits:(units:typeof visible)=>{visible=units;writes++;},setAutoRepair:()=>{},setRepairProgress:()=>{}})();
sync(false,false);assert.deepEqual(visible,six.units);assert.equal(writes,1);
sync(true,false);sync(false,true);assert.equal(writes,1,'Unsaved edits and running draft must not be replaced by prop sync');
console.log('PASS UI: real sync callback reads V5 over stale props and preserves unsaved/running drafts');

const reload=getATPUnitMappingV5('y')!,savedBytes=JSON.stringify(reload);
const timed=await runStep07AutoRepair(options(f,{mapping:JSON.parse(savedBytes),persistedMapping:JSON.parse(savedBytes),callTimeoutMs:5,analyze:async()=>new Promise(resolve=>setTimeout(()=>resolve({summary:{} as any,atpFindings:[],materialFindings:[],alignmentProposals:[]}),40))}));
assert.equal(timed.outcome,'TIMEOUT');assert(timed.persisted);assert.equal(valid(timed.mapping),6);
const checkpointBytes=memory.get(step07CheckpointKey(resolveStep07CheckpointContext('y')));
await new Promise(resolve=>setTimeout(resolve,60));
assert.equal(JSON.stringify(getATPUnitMappingV5('y')),savedBytes);assert.equal(memory.get(step07CheckpointKey(resolveStep07CheckpointContext('y'))),checkpointBytes);
console.log('PASS 2: timeout and late response preserve exact V5/checkpoint bytes after reload');

// Keep newer progress in other Bab while retaining a real unsaved teacher edit.
const manual=structuredClone(four),manualId=manual.units[0].id;
const invalidationsBefore=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.invalidated?.length || 0;
manual.units[0].materials[0].title+=' — koreksi guru';manual.units[0].materials[0].linkedTpIds=[];manual.units[0].materials[0].linkedAtpItemIds=[];
const edited=await runStep07AutoRepair(options(f,{mapping:manual,persistedMapping:four,analyze:async()=>{throw Error('API_FAILURE: manual edit retry');}}));
assert.equal(edited.mapping.units[0].materials[0].title,manual.units[0].materials[0].title);
for(const unit of six.units.filter(u=>!four.units.some(old=>old.id===u.id&&JSON.stringify(old)===JSON.stringify(u))))assert.deepEqual(edited.mapping.units.find(u=>u.id===unit.id),unit);
assert.equal(valid(edited.mapping),5);assert(edited.persisted);assert(!edited.readiness.canProceed);
const drops=readStep07Diagnostics(resolveStep07CheckpointContext('y')).events.filter(e=>e.kind==='PROGRESS_DECREASE');
assert(drops.some(e=>e.unitId===manualId&&e.reason?.includes('material:')));
const cp=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;
const invalidated=cp.invalidated!.slice(invalidationsBefore).map(i=>i.unitId);assert.deepEqual([...new Set(invalidated)],[manualId]);
console.log('PASS 3: real one-Bab manual edit decreases readiness 6 -> 5 with its ID/reason; unrelated saved Bab survive');

const stored=getATPUnitMappingV5('y')!,conflicting=structuredClone(six);
conflicting.units[0].materials[0].title+=' — different unsaved manual edit';
const beforeConflict=JSON.stringify(stored);
const conflict=await runStep07AutoRepair(options(f,{mapping:conflicting,persistedMapping:six,analyze:async()=>{throw Error('AI must not run on conflict');}}));
assert(conflict.stale);assert(conflict.issues.some(i=>i.includes(manualId)));assert.equal(JSON.stringify(getATPUnitMappingV5('y')),beforeConflict);
console.log('PASS 4: concurrent edits of the same Bab fail closed, retaining stored and caller manual data');

for(const point of Object.values(cp.units))point.status='DONE';writeStep07Checkpoint(cp);
assert.equal(countStep07CompletedUnits(stored,f.atp,f.tp),5,'Checkpoint DONE labels cannot invent readiness');
assert(!resolveATPUnitMappingReadiness(stored,f.atp,f.tp).canProceed);
console.log('PASS 5: optimistic/stale checkpoint status cannot fake completed Bab or unlock Step08');
console.log('PASS 7 progress persistence scenarios. Provider/Web Locks simulated; live Gemini/browser not verified.');
