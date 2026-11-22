import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';
import {evaluateExpression,initializer} from './helpers/uiContractHarness';
import {runStep07AutoRepair,undoStep07AutoRepair,type Step07RepairOptions} from '../src/services/step07AutoRepairService';
import {countStep07CompletedUnits,resolveATPUnitMappingReadiness} from '../src/services/atpMappingReadinessService';
import {applyMinimalAlignment,hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {step07SourceKey} from '../src/services/step07AutoExecutionPolicy';
import {readStep07Checkpoint,writeStep07Checkpoint,resolveStep07CheckpointContext,step07CanonicalKey,step07UnitKey} from '../src/services/step07CheckpointService';
import {saveStorageV5,loadStorageV5,saveATPUnitMappingV5,getATPUnitMappingV5,serializeBackupV5,parseBackupV5} from '../src/services/storageV5';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
import type {ATPUnitMappingData,ATPData,TPData,Step07AutoRequest,Step07SemanticCheck} from '../src/types';
const raw=JSON.parse(readFileSync('scripts/fixtures/pjokClass6RealProjectEvidence.json','utf8'));
const memory=new Map<string,string>(),locks=new Set<string>();
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(key:string,options:any,callback:any)=>{if(locks.has(key)&&options.ifAvailable)return callback(null);while(locks.has(key))await new Promise(r=>setTimeout(r,1));locks.add(key);try{return await callback({name:key});}finally{locks.delete(key);}}}});
function seed(){memory.clear();const state=createReadyV21WorkflowFixture();const f=structuredClone(raw) as {mapping:ATPUnitMappingData;atp:ATPData;tp:TPData};state.annualData.tp=[{yearPlanId:'y',value:f.tp}];state.annualData.atp=[{yearPlanId:'y',value:f.atp}];state.annualData.atpUnitMappings=[{yearPlanId:'y',value:f.mapping}];saveStorageV5(state);return f;}
type Fixture=ReturnType<typeof seed>;
const others=(m:ATPUnitMappingData,id:string)=>JSON.stringify(m.units.filter(u=>u.id!==id));
function actions(f:Fixture,m:ATPUnitMappingData):AlignmentAction[]{const tp=f.tp.items.find(t=>t.code==='E1-SKG-01')!;return m.units.flatMap(u=>u.materials.filter(mat=>!mat.linkedTpIds.length).map(mat=>({id:'target-'+mat.id,type:'EDIT_MATERIAL' as const,targetUnitId:u.id,targetMaterialId:mat.id,before:mat.title,after:mat.title+' — '+tp.competence+' '+tp.contentScope,linkedTpIds:[tp.id],reason:'Simulated proposal: retain the original activity and specify investigation of its movement concepts.',evidence:[{tpId:tp.id,tpQuote:tp.statement,materialQuote:mat.title}]})));}
function checks(f:Fixture,items:AlignmentAction[]):Step07SemanticCheck[]{return items.map(a=>({actionId:a.id,verdict:'SUPPORTED',reason:'Simulated independent verifier: planned investigation retains the activity context and develops the stated canonical movement competence.',missingEvidence:[],evidence:a.linkedTpIds.map(id=>({tpId:id,tpQuote:f.tp.items.find(t=>t.id===id)!.statement,materialQuote:a.before!,competenceQuote:f.tp.items.find(t=>t.id===id)!.competence,contextQuote:a.before!}))}));}
function provider(f:Fixture,calls:Step07AutoRequest[]=[]):Step07RepairOptions['analyze']{return async(m,r)=>{calls.push(structuredClone(r));if(r.execution?.activeUnitId){assert.equal(m.units.length,1);assert.equal(m.units[0].id,r.execution.activeUnitId);assert.equal(r.execution.otherUnits.length,8);}return r.phase==='VERIFY'?{summary:{} as any,atpFindings:[],materialFindings:[],step07SemanticChecks:checks(f,r.actions || [])}:sanitizeMappingAnalysisResult({alignmentProposals:actions(f,m)},{currentMapping:m,atpData:f.atp,tpData:f.tp,step07Auto:r});};}
function options(f:Fixture,extra:Partial<Step07RepairOptions>={}):Step07RepairOptions{return {...f,mapping:getATPUnitMappingV5('y')!,persistedMapping:getATPUnitMappingV5('y'),targetUnitId:f.mapping.units[0].id,checkpointContext:resolveStep07CheckpointContext('y'),save:m=>{saveATPUnitMappingV5('y',m);return true;},isCurrent:()=>true,analyze:provider(f),...extra};}
let passed=0;async function test(name:string,run:()=>Promise<void>|void){await run();console.log('PASS '+(++passed)+'. '+name);}
await test('Real 6/9 fixture: only Bab 1 receives PROPOSE (no VERIFY), saves to V5/checkpoint, reload remains 7/9',async()=>{
  const f=seed(),id=f.mapping.units[0].id,before=others(f.mapping,id),canonical=JSON.stringify([f.atp,f.tp]),calls:Step07AutoRequest[]=[];
  assert.equal(countStep07CompletedUnits(f.mapping,f.atp,f.tp),6);
  const result=await runStep07AutoRepair(options(f,{analyze:provider(f,calls)}));
  assert(result.persisted);assert(!result.saved&&!result.readiness.canProceed);assert.equal(countStep07CompletedUnits(result.mapping,f.atp,f.tp),7);
  assert.deepEqual(calls.map(r=>r.phase),['PROPOSE']);assert(calls.every(r=>r.execution?.activeUnitId===id&&!r.execution.reconciliation));
  assert.equal(others(result.mapping,id),before);assert.equal(others(getATPUnitMappingV5('y')!,id),before);assert.equal(JSON.stringify([f.atp,f.tp]),canonical);
  const checkpoint=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;assert.equal(checkpoint.units[id].status,'DONE');assert.deepEqual(Object.keys(checkpoint.units),[id]);assert(!checkpoint.units.GLOBAL);
  assert.equal(countStep07CompletedUnits(JSON.parse(JSON.stringify(getATPUnitMappingV5('y'))),f.atp,f.tp),7);
  const restored=parseBackupV5(serializeBackupV5(loadStorageV5()));assert.equal(restored.annualData.atpUnitMappings![0].value.step07AutoRepair!.targetUnitId,id);
  const bytes=JSON.stringify(getATPUnitMappingV5('y')),cpBytes=JSON.stringify(checkpoint);let saves=0;
  const again=await runStep07AutoRepair(options(f,{analyze:async()=>{throw Error('A valid Bab must skip AI');},save:()=>{saves++;return true;}}));
  assert(again.persisted);assert.equal(saves,0);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),bytes);assert.equal(JSON.stringify(readStep07Checkpoint(resolveStep07CheckpointContext('y'))),cpBytes);
});
await test('API failure and timeout retain saved Bab, aborted late responses cannot write',async()=>{
  for(const timeout of [false,true]){const f=seed(),before=JSON.stringify(getATPUnitMappingV5('y'));const result=await runStep07AutoRepair(options(f,{callTimeoutMs:5,analyze:async()=>timeout?new Promise(resolve=>setTimeout(()=>resolve({summary:{} as any,atpFindings:[],materialFindings:[]}),40)):Promise.reject(Error('API_FAILURE: fixture unavailable'))}));assert(!result.saved);assert(!result.readiness.canProceed);assert.equal(countStep07CompletedUnits(result.mapping,f.atp,f.tp),6);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);const checkpoint=JSON.stringify(readStep07Checkpoint(resolveStep07CheckpointContext('y')));await new Promise(r=>setTimeout(r,60));assert.equal(JSON.stringify(readStep07Checkpoint(resolveStep07CheckpointContext('y'))),checkpoint);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);}
});
await test('Unsaved edits in another Bab stay in returned draft and are not included in the target save',async()=>{
  const f=seed(),draft=structuredClone(f.mapping),id=draft.units[0].id;draft.units[4].materials[0].title+=' — perubahan manual belum disimpan';const otherDraft=others(draft,id),savedOthers=others(f.mapping,id);
  const result=await runStep07AutoRepair(options(f,{mapping:draft}));
  assert(!result.persisted,'The returned full draft still has unsaved other-Bab edits');assert.equal(others(result.mapping,id),otherDraft);assert.equal(others(getATPUnitMappingV5('y')!,id),savedOthers);
  assert.equal(result.mapping.units[0].materials[0].title,getATPUnitMappingV5('y')!.units[0].materials[0].title);assert(!result.readiness.canProceed);
});
await test('Failed AI never commits unsaved target edits, including the legacy in-progress marker path',async()=>{
  for(const legacy of [false,true]){
    const f=seed();if(legacy){delete f.mapping.step07AutoRepair;const state=loadStorageV5();state.annualData.atpUnitMappings![0].value=f.mapping;saveStorageV5(state);}
    const draft=structuredClone(f.mapping),target=draft.units[1];target.materials[0].title+=' — suntingan manual belum tervalidasi';
    const originalUnits=JSON.stringify(getATPUnitMappingV5('y')!.units),originalStored=JSON.stringify(getATPUnitMappingV5('y'));
    const result=await runStep07AutoRepair(options(f,{mapping:draft,targetUnitId:target.id,analyze:async()=>{throw Error('API_FAILURE: fixture unavailable');}}));
    assert.equal(JSON.stringify(getATPUnitMappingV5('y')!.units),originalUnits);if(!legacy)assert.equal(JSON.stringify(getATPUnitMappingV5('y')),originalStored);
    assert.equal(result.mapping.units[1].materials[0].title,target.materials[0].title);assert(!result.persisted&&!result.saved);assert(!result.readiness.canProceed);
  }
});
await test('Target manual edits survive; concurrent manual conflict or drift cannot overwrite either snapshot',async()=>{
  let f=seed(),draft=structuredClone(f.mapping);draft.units[0].materials[0].title+=' hasil sunting guru';const title=draft.units[0].materials[0].title;
  const done=await runStep07AutoRepair(options(f,{mapping:draft}));assert(done.mapping.units[0].materials[0].title.startsWith(title));assert(done.persisted);
  f=seed();draft=structuredClone(f.mapping);draft.units[0].title+=' draf lokal';const state=loadStorageV5();state.annualData.atpUnitMappings![0].value.units[0].title+=' edit dari tab lain';saveStorageV5(state);const before=JSON.stringify(getATPUnitMappingV5('y'));
  const conflict=await runStep07AutoRepair(options(f,{mapping:draft,persistedMapping:f.mapping,analyze:async()=>{throw Error('Conflict must not call AI');}}));assert(conflict.stale);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);assert.equal(conflict.mapping.units[0].title,draft.units[0].title);
  f=seed();const base=provider(f);let fresh=true;const initial=JSON.stringify(getATPUnitMappingV5('y'));
  const stale=await runStep07AutoRepair(options(f,{isCurrent:()=>fresh,analyze:async(m,r,s)=>{const result=await base(m,r,s);fresh=false;return result;}}));assert(stale.stale);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),initial);
});
await test('Cross-Bab and other-Bab actions are filtered, never verified/applied or routed to GLOBAL',async()=>{
  const f=seed(),id=f.mapping.units[0].id,before=others(f.mapping,id),calls:Step07AutoRequest[]=[];const base=provider(f,calls);
  const result=await runStep07AutoRepair(options(f,{analyze:async(m,r,s)=>{if(r.phase==='VERIFY'){assert(r.actions!.every(a=>a.targetUnitId===id&&(!a.sourceUnitId||a.sourceUnitId===id)));return base(m,r,s);}const local=actions(f,m),other=f.mapping.units[3],foreign={...actions(f,{...f.mapping,units:[other]})[0],id:'foreign'},move={...local[0],id:'cross-move',type:'MOVE_MATERIAL' as const,targetUnitId:other.id,sourceUnitId:id};return {summary:{} as any,atpFindings:[],materialFindings:[],alignmentProposals:[...local,foreign,move].map(action=>({id:action.id,action,validationStatus:'READY',targetUnitId:action.targetUnitId,targetMaterialId:action.targetMaterialId,before:action.before!,after:action.after || '',tpIds:action.linkedTpIds,reason:action.reason,impact:{newlyCoveredTpIds:[],newlyMappedAtpIds:[]}}))};}}));
  assert(result.persisted);assert.equal(others(result.mapping,id),before);assert(!readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.units.GLOBAL);
  assert(result.issues.some(i=>i.includes('TARGET_UNIT_CONFLICT'))||readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.units[id].events.some(e=>e.reason.includes('TARGET_UNIT_CONFLICT')));
});
await test('Other Bab pending checkpoint/buffer is preserved; all-Bab continuation still completes global readiness',async()=>{
  const f=seed(),context=resolveStep07CheckpointContext('y'),other=f.mapping.units[3],a=actions(f,{...f.mapping,units:[other]})[0],proof=checks(f,[a]);
  const candidate=applyMinimalAlignment(f.mapping.units,[a],f.atp,f.tp,{scope:'STEP07_AUTO_REPAIR',sourceKey:step07SourceKey(f.mapping.units,f.atp,f.tp),checks:proof});assert(candidate.success);
  const entry={source:step07UnitKey(candidate.nextUnits!.find(u=>u.id===other.id)!),baseSource:step07UnitKey(other),dependency:step07CanonicalKey(f.atp,f.tp),stage:'APPLY' as const,status:'RUNNING' as const,applied:[a.id],events:[]};
  writeStep07Checkpoint({schemaVersion:1,revision:0,context,canonical:step07CanonicalKey(f.atp,f.tp),units:{[other.id]:entry},beforeUnits:structuredClone(f.mapping.units),baseStoredKey:'legacy',mode:'REPAIR',workingMapping:{...f.mapping,units:candidate.nextUnits!}});
  const result=await runStep07AutoRepair(options(f));assert(result.persisted);
  const cp=readStep07Checkpoint(context)!;assert.deepEqual(cp.units[other.id],entry);assert.deepEqual(cp.workingMapping!.units.find(u=>u.id===other.id),candidate.nextUnits!.find(u=>u.id===other.id));assert.equal(others(getATPUnitMappingV5('y')!,f.mapping.units[0].id),others(f.mapping,f.mapping.units[0].id));
  const all=await runStep07AutoRepair(options(f,{targetUnitId:undefined}));assert(all.saved,all.issues.join('; '));assert(all.readiness.canProceed);assert.equal(countStep07CompletedUnits(all.mapping,f.atp,f.tp),9);
});
await test('Preserved checkpoint buffers with changed canonical dependencies cannot be restored on the next Bab run',async()=>{
  const f=seed(),context=resolveStep07CheckpointContext('y'),other=f.mapping.units[3],a=actions(f,{...f.mapping,units:[other]})[0];
  const candidate=applyMinimalAlignment(f.mapping.units,[a],f.atp,f.tp,{scope:'STEP07_AUTO_REPAIR',sourceKey:step07SourceKey(f.mapping.units,f.atp,f.tp),checks:checks(f,[a])});assert(candidate.success);
  const canonical=step07CanonicalKey(f.atp,f.tp);
  writeStep07Checkpoint({schemaVersion:1,revision:0,context,canonical,units:{[other.id]:{source:step07UnitKey(candidate.nextUnits!.find(u=>u.id===other.id)!),baseSource:step07UnitKey(other),dependency:canonical,stage:'APPLY',status:'RUNNING',applied:[a.id],events:[]}},beforeUnits:structuredClone(f.mapping.units),baseStoredKey:'legacy',mode:'REPAIR',workingMapping:{...f.mapping,units:candidate.nextUnits!}});
  f.tp.items[4].statement+=' Konteks sumber diperbarui.';const state=loadStorageV5();state.annualData.tp[0].value=f.tp;saveStorageV5(state);
  const first=await runStep07AutoRepair(options(f));assert(first.persisted);assert.equal(readStep07Checkpoint(context)!.units[other.id].dependency,canonical);
  const before=JSON.stringify(getATPUnitMappingV5('y'));
  const next=await runStep07AutoRepair(options(f,{targetUnitId:other.id,analyze:async()=>{throw Error('API_FAILURE: fixture unavailable');}}));
  assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);assert.deepEqual(next.mapping.units.find(u=>u.id===other.id),other);
  assert(readStep07Checkpoint(context)!.invalidated?.some(i=>i.unitId===other.id));
});
await test('Complete IDs need no history-only repair, AI or checkpoint writes',async()=>{
  const f=seed(),unit=f.mapping.units[1];unit.actionHistory=[];for(const m of unit.materials)m.titleHistory=[];const state=loadStorageV5();state.annualData.atpUnitMappings![0].value=f.mapping;saveStorageV5(state);const before=JSON.stringify(getATPUnitMappingV5('y'));
  const result=await runStep07AutoRepair(options(f,{targetUnitId:unit.id,analyze:async()=>{throw Error('No proof-only AI');},save:()=>{throw Error('No proof-only save');}}));assert(result.persisted);assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);
});
await test('Same-profile concurrent calls and missing target fail closed',async()=>{
  const f=seed(),base=provider(f);let release!:()=>void;const gate=new Promise<void>(r=>release=r);let entered!:()=>void;const waiting=new Promise<void>(r=>entered=r);
  const first=runStep07AutoRepair(options(f,{analyze:async(m,r,s)=>{entered();await gate;return base(m,r,s);}}));await waiting;
  const second=await runStep07AutoRepair(options(f,{targetUnitId:f.mapping.units[3].id,analyze:async()=>{throw Error('Lock must prevent second AI process');}}));assert(second.issues.some(i=>i.includes('CHECKPOINT_BUSY')));release();assert((await first).persisted);
  const before=JSON.stringify(getATPUnitMappingV5('y'));await assert.rejects(runStep07AutoRepair(options(f,{targetUnitId:''})),/TARGET_UNIT_NOT_FOUND/);const missing=await runStep07AutoRepair(options(f,{targetUnitId:'missing',save:()=>{throw Error('Must not save unknown target');}}));assert(missing.issues.some(i=>i.includes('TARGET_UNIT_NOT_FOUND')));assert.equal(JSON.stringify(getATPUnitMappingV5('y')),before);
});
await test('Undo a non-first Bab restores only its snapshot/history and keeps other Bab byte-identical',async()=>{
  const f=seed(),id=f.mapping.units[3].id;
  const done=await runStep07AutoRepair(options(f,{targetUnitId:id}));assert(done.persisted);assert.equal(done.mapping.step07AutoRepair!.targetUnitId,id);
  const before=others(done.mapping,id),undone=undoStep07AutoRepair(done.mapping,f.atp,f.tp);
  assert(undone.success,undone.issues.join('; '));assert.equal(others(undone.mapping!,id),before);assert.equal(countStep07CompletedUnits(undone.mapping!,f.atp,f.tp),6);
  assert(!resolveATPUnitMappingReadiness(undone.mapping!,f.atp,f.tp).canProceed);
});
await test('Actual UI exposes 9 scoped buttons; the actual handler prevents double click and passes only the selected ID',async()=>{
  const f=seed(),html=renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{...f,onSaveMapping:()=>true,onNextStep:()=>{},onBackToATP:()=>{}}));assert.equal((html.match(/Analisis Ulang Bab Ini/g)||[]).length,9);
  let calls=0,release!:(v:any)=>void,lastNotice:any;const pending=new Promise(r=>release=r),busy={current:false},noop=()=>{};
  const result={mapping:f.mapping,stale:false,persisted:true,saved:false,analysis:undefined,appliedActions:[],issues:['API_FAILURE: simulated'],outcome:'INCOMPLETE'};
  const bindings={analysisBusyRef:busy,isGeneratingStructure:false,setUnitRepairState:(v:any)=>lastNotice=v,setIsAnalyzing:noop,setAutoPhase:noop,setAnalysisError:noop,setApplyIssues:noop,setAppliedNotice:noop,setSelectedAnalysisActionIds:noop,analysisRequestIdRef:{current:0},generationContextRef:{current:'source'},buildCurrentMappingDraft:()=>f.mapping,resolveStep07CheckpointContext:()=>resolveStep07CheckpointContext('y'),mapping:f.mapping,atpRef:{current:f.atp},tpRef:{current:f.tp},setCheckpointWork:noop,academicSetting:{subject:'PJOK',grade:'Kelas 6',phase:'Fase C'},analyzeATPUnitMappingWithAI:noop,onSaveMapping:noop,setRepairProgress:noop,setAlignmentRollback:noop,computeMappingFingerprint:()=> 'fp',setUnits:noop,unitsRef:{current:f.mapping.units},setAutoRepair:noop,setHasChanges:noop,setAnalysisResult:noop,setLastAnalysisSnapshot:noop,setLastAppliedActionIds:noop,setAnalysisFingerprint:noop,setSaveSuccessNotice:noop,resolveATPUnitMappingReadiness,getATPUnitMappingV5,runStep07AutoRepair:async(o:Step07RepairOptions)=>{calls++;assert.equal(o.targetUnitId,f.mapping.units[0].id);await pending;return result;}};
  const handler=evaluateExpression(initializer('src/components/ATPUnitMappingManager.tsx','handleAnalyzeMapping'),bindings);
  const run=handler(f.mapping.units[0].id);await handler(f.mapping.units[3].id);await handler();assert.equal(calls,1);assert(busy.current);release(result);await run;assert(!busy.current);assert.equal(lastNotice.unitId,f.mapping.units[0].id);assert.equal(lastNotice.remaining,2);assert.equal(lastNotice.success,false);
  bindings.runStep07AutoRepair=async()=>({...result,outcome:'SAVE_FAILED',issues:['CHECKPOINT_SAVE_FAILED: fixture']});
  const failed=evaluateExpression(initializer('src/components/ATPUnitMappingManager.tsx','handleAnalyzeMapping'),bindings);await failed(f.mapping.units[1].id);assert.equal(lastNotice.remaining,0);assert.equal(lastNotice.success,false);assert(lastNotice.message.includes('Snapshot Bab tersimpan tetap aman'));
});
console.log(`PASS ${passed}/${passed} targeted Bab scenarios. AI provider and Web Locks are simulated; no live Gemini success is claimed.`);
