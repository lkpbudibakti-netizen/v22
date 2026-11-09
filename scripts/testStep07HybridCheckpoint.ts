import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import React from 'react';
import * as XLSX from 'xlsx';
import {renderToStaticMarkup} from 'react-dom/server';
import {ATPUnitMappingManager} from '../src/components/ATPUnitMappingManager';
import {runStep07AutoRepair,undoStep07AutoRepair,type Step07RepairOptions} from '../src/services/step07AutoRepairService';
import {detectStep07Mode} from '../src/services/step07HybridRepairService';
import {readStep07Checkpoint,resolveStep07CheckpointContext,step07CheckpointKey,writeStep07Checkpoint,withStep07StorageWrite,type Step07Stage} from '../src/services/step07CheckpointService';
import {applyMinimalAlignment,hasTeacherMaterialSupport,type AlignmentAction} from '../src/services/mappingAlignmentService';
import {resolveATPUnitMappingReadiness} from '../src/services/atpMappingReadinessService';
import {parseBabMateriXlsx} from '../src/services/atpUnitMappingImportService';
import {sanitizeMappingAnalysisResult} from '../server/mappingAnalysis';
import {createReadyV21WorkflowFixture} from './fixtures/v21ReadyWorkflowFixture';
import {saveStorageV5,loadStorageV5,saveATPUnitMappingV5,getATPUnitMappingV5} from '../src/services/storageV5';
import {copyCPAnalysisDiagnosis} from '../src/services/cpAnalysisAIDiagnostics';
import type {ATPData,TPData,ATPUnitMappingData,Step07AutoRequest,Step07SemanticCheck} from '../src/types';
import type {MappingAnalysisResult} from '../src/services/aiService';
const raw=JSON.parse(readFileSync('scripts/fixtures/pjokClass6MappingDiagnostic.json','utf8'));
const memory=new Map<string,string>();
(globalThis as any).localStorage={getItem:(k:string)=>memory.get(k)||null,setItem:(k:string,v:string)=>memory.set(k,v),removeItem:(k:string)=>memory.delete(k)};
const locked=new Set<string>();
Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{request:async(key:string,options:{ifAvailable?:boolean;signal?:AbortSignal},fn:(lock:unknown)=>Promise<unknown>)=>{if(locked.has(key)&&options.ifAvailable)return fn(null);while(locked.has(key)){if(options.signal?.aborted)throw Error('Aborted');await new Promise(r=>setTimeout(r,1));}locked.add(key);try{return await fn({name:key});}finally{locked.delete(key);}}}});
function seed(empty=false){
  memory.clear();const state=createReadyV21WorkflowFixture();
  const tp:TPData={id:'tp',academicSettingId:'y',workflowStatus:'SIAP',updatedAt:'2026-11-09',items:structuredClone(raw.tp)};
  const atp:ATPData={id:'atp',academicSettingId:'y',tpDataId:'tp',workflowStatus:'SIAP',updatedAt:tp.updatedAt,items:structuredClone(raw.atp)};
  const book=XLSX.utils.book_new();XLSX.utils.book_append_sheet(book,XLSX.utils.json_to_sheet(raw.units.flatMap((u:any)=>u.materials.map((m:any)=>({babOrder:u.order,babTitle:u.title,materialOrder:m.order,materialTitle:m.title})))),'BAB_MATERI');
  const imported=parseBabMateriXlsx(new Uint8Array(XLSX.write(book,{type:'array',bookType:'xlsx'})));assert(imported.success,imported.errors?.join('; '));
  const mapping:ATPUnitMappingData={id:'map',academicSettingId:'y',tpDataId:'tp',atpId:'atp',updatedAt:tp.updatedAt,units:empty?imported.units!:structuredClone(raw.units)};
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
let count=0;async function test(name:string,fn:()=>Promise<void>|void){await fn();console.log('PASS '+(++count)+'. '+name);}
let completeFixture:ATPUnitMappingData;
await test('Actual Excel import has zero lineage; INITIAL_MAPPING resolves all 9 Bab/27 materials with isolated unit inputs',async()=>{
  const f=seed(true),calls:Step07AutoRequest[]=[];assert.equal(detectStep07Mode(f.mapping,f),'INITIAL_MAPPING');
  assert(f.mapping.units.every(u=>!u.linkedTpIds.length&&u.materials.every(m=>!m.linkedTpIds.length)));
  const result=await runStep07AutoRepair(options(f,{analyze:provider(f,calls)}));
  assert(result.saved,result.issues.join('; '));assert(result.readiness.canProceed);assert.equal(result.mapping.units.length,9);assert.equal(result.mapping.units.flatMap(u=>u.materials).length,27);
  const cp=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;assert.equal(Object.values(cp.units).filter(p=>p.status==='DONE').length,10);
  assert(calls.filter(c=>c.phase==='PROPOSE').length<=10);assert.equal(detectStep07Mode(result.mapping,f),'VALIDATE');
});
await test('Partial fixture uses REPAIR; completed Bab and VALIDATE mode need no repeated AI',async()=>{
  const f=seed(),calls:Step07AutoRequest[]=[];assert.equal(detectStep07Mode(f.mapping,f),'REPAIR');
  const done=await runStep07AutoRepair(options(f,{analyze:provider(f,calls)}));assert(done.saved,done.issues.join('; '));
  completeFixture=structuredClone(done.mapping);
  const again=await runStep07AutoRepair(options(f,{analyze:async()=>{throw Error('VALIDATE must skip AI');}}));assert(again.saved,again.issues.join('; '));assert.deepEqual(again.mapping.units,done.mapping.units);
});
await test('Every successful stage survives interruption and reload without repeating completed AI calls',async()=>{
  for(const stop of ['ANALYZE','PROPOSE','VERIFY','APPLY','VALIDATE','SAVE'] as Step07Stage[]){
    const f=seed(),calls:Step07AutoRequest[]=[];let interrupted=false;
    const first=await runStep07AutoRepair(options(f,{analyze:provider(f,calls),onCheckpoint:(stage,data)=>{if(stage===stop&&data.success&&!interrupted){interrupted=true;throw Error('CHECKPOINT_INTERRUPT: '+stop);}}}));
    assert(interrupted,stop);assert(!first.saved,stop);
    const context=resolveStep07CheckpointContext('y'),checkpoint=readStep07Checkpoint(context)!;
    const priorCalls=calls.length;const pending=Object.values(checkpoint.units).find(p=>p.analysis);assert(pending?.analysis,stop);
    const resumed=await runStep07AutoRepair(options(f,{analyze:provider(f,calls)}));assert(resumed.saved,stop+': '+resumed.issues.join('; '));
    const firstUnit=calls[0].execution!.activeUnitId;
    assert.equal(calls.filter(c=>c.execution?.activeUnitId===firstUnit&&c.phase==='PROPOSE').length,1,stop+' repeated PROPOSE');
    if(['VERIFY','APPLY','VALIDATE','SAVE'].includes(stop))assert.equal(calls.filter(c=>c.execution?.activeUnitId===firstUnit&&c.phase==='VERIFY').length,1,stop+' repeated VERIFY');
    assert(calls.length>=priorCalls);assert(resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed);
  }
});
await test('VERIFY timeout resumes the saved proposal; late responses cannot alter released checkpoints',async()=>{
  const f=seed(),calls:Step07AutoRequest[]=[],base=provider(f,calls);let delayed=false;
  const first=await runStep07AutoRepair(options(f,{callTimeoutMs:5,analyze:async(m,r,s)=>{if(r.phase==='VERIFY'&&!delayed){delayed=true;return new Promise(resolve=>setTimeout(async()=>resolve(await base(m,r,s)),80));}return base(m,r,s);}}));
  assert.equal(first.outcome,'TIMEOUT');const checkpoint=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;
  assert(Object.values(checkpoint.units).some(p=>p.events.some(e=>e.stage==='VERIFY'&&!e.success&&e.reason.includes('TIMEOUT'))));
  const done=await runStep07AutoRepair(options(f,{analyze:base}));assert(done.saved,done.issues.join('; '));
  const key=step07CheckpointKey(resolveStep07CheckpointContext('y')),rawBefore=memory.get(key);await new Promise(r=>setTimeout(r,100));assert.equal(memory.get(key),rawBefore);
  const active=calls.find(r=>r.phase==='PROPOSE')!.execution!.activeUnitId;assert.equal(calls.filter(r=>r.phase==='PROPOSE'&&r.execution?.activeUnitId===active).length,1);
});
await test('A failing action is isolated, rejection stages persist, and full-run rollback retains teacher history',async()=>{
  const f=seed(),base=provider(f);let inject=true;
  const result=await runStep07AutoRepair(options(f,{analyze:async(m,r,s)=>{const value=await base(m,r,s);if(inject&&r.phase==='PROPOSE'){inject=false;value.alignmentProposals![0].action!.evidence=[];value.alignmentProposals![0].validationStatus='READY';}return value;}}));
  assert(result.saved,result.issues.join('; '));const cp=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;
  assert(Object.values(cp.units).some(p=>p.events.some(e=>e.stage==='APPLY'&&!e.success&&e.reason.includes('EVIDENCE'))));
  assert(Object.values(cp.units).some(p=>p.applied.length>1));
  const saved=getATPUnitMappingV5('y')!,undo=undoStep07AutoRepair(saved,f.atp,f.tp);assert(undo.success,undo.issues.join('; '));
  saveATPUnitMappingV5('y',undo.mapping!);assert(!resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed);
  assert(undo.mapping!.units.some(u=>u.actionHistory?.some(h=>h.kind==='UNDO')));
});
await test('Canonical edits invalidate pending analysis; draft edits invalidate only their Bab and survive undo',async()=>{
  for(const changed of ['TP','ATP','OTHER_BAB']){
    const f=seed(),calls:Step07AutoRequest[]=[];let interrupted=false;
    await runStep07AutoRepair(options(f,{analyze:provider(f,calls),onCheckpoint:(stage,data)=>{if(stage==='VERIFY'&&data.success&&!interrupted){interrupted=true;throw Error('CHECKPOINT_INTERRUPT');}}}));
    const active=calls[0].execution!.activeUnitId!,state=loadStorageV5();
    let manualId='';
    if(changed==='TP'){f.tp.items[4].statement+=' Sesuai konteks kesehatan.';state.annualData.tp[0].value=f.tp;}
    if(changed==='ATP'){f.atp.items[4].focus='Kesehatan dan keselamatan';state.annualData.atp[0].value=f.atp;}
    if(changed==='OTHER_BAB'){const unit=state.annualData.atpUnitMappings![0].value.units.find(u=>u.id!==active)!;manualId=unit.id;unit.title+=' (edit manual)';}
    saveStorageV5(state);
    const result=await runStep07AutoRepair(options(f,{analyze:provider(f,calls)}));assert(result.saved,changed+': '+result.issues.join('; '));
    assert.equal(calls.filter(r=>r.phase==='PROPOSE'&&r.execution?.activeUnitId===active).length,changed==='OTHER_BAB'?1:2,changed);
    if(changed==='OTHER_BAB'){
      assert(result.mapping.units.find(u=>u.id===manualId)!.title.includes('edit manual'));
      const undo=undoStep07AutoRepair(result.mapping,f.atp,f.tp);assert(undo.success);assert(undo.mapping!.units.find(u=>u.id===manualId)!.title.includes('edit manual'));
    }else assert(readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.invalidated?.some(p=>p.reason.includes('TP/ATP')));
  }
});
await test('Cross-tab exclusion is fail-closed; profile namespaces are independent and quota errors retain raw checkpoints',async()=>{
  const f=seed(),base=provider(f);let release!:()=>void,entered!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);let wait=true;
  const first=runStep07AutoRepair(options(f,{analyze:async(m,r,s)=>{if(wait){wait=false;entered();await gate;}return base(m,r,s);}}));
  await ready;const busy=await runStep07AutoRepair(options(f,{analyze:async()=>{throw Error('Busy must not call AI');}}));assert(busy.issues.some(i=>i.includes('CHECKPOINT_BUSY')));
  const context=resolveStep07CheckpointContext('y');assert.notEqual(step07CheckpointKey(context),step07CheckpointKey({...context,profileId:'p2'}));
  release();assert((await first).saved);
  const cp=readStep07Checkpoint(context)!,rawBefore=memory.get(step07CheckpointKey(context));writeStep07Checkpoint(cp);assert.equal(memory.get(step07CheckpointKey(context)),rawBefore,'idempotent persistence');
  const set=localStorage.setItem;localStorage.setItem=()=>{throw Error('QuotaExceeded');};cp.activeUnitId='test-quota';assert.throws(()=>writeStep07Checkpoint(cp),/CHECKPOINT_SAVE_FAILED/);localStorage.setItem=set;assert.equal(memory.get(step07CheckpointKey(context)),rawBefore);
});
await test('Single diagnostic control uses clipboard fallback and exposes selectable text when both APIs fail',async()=>{
  const f=seed(),html=renderToStaticMarkup(React.createElement(ATPUnitMappingManager,{...f,onSaveMapping:()=>true,onNextStep:()=>{},onBackToATP:()=>{}}));
  assert.equal((html.match(/id="btn-copy-mapping-diagnostic"/g)||[]).length,1);
  const source=readFileSync('src/components/ATPUnitMappingManager.tsx','utf8');assert.equal((source.match(/onClick=\{handleCopyDiagnostic\}/g)||[]).length,1);assert(source.includes('setManualDiagnostic'));assert(source.includes('STEP07 PERSISTENT CHECKPOINT'));
  const nav=globalThis.navigator as any;Object.defineProperty(nav,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Denied');}}});
  const prior=(globalThis as any).document;let selected=false,removed=false;
  (globalThis as any).document={activeElement:null,createElement:()=>({style:{},setAttribute:()=>{},select:()=>{selected=true;},remove:()=>{removed=true;}}),body:{appendChild:()=>{}},execCommand:()=>true};
  assert.equal(await copyCPAnalysisDiagnosis('report'),'copied');assert(selected&&removed);
  (globalThis as any).document.execCommand=()=>false;assert.equal(await copyCPAnalysisDiagnosis('report'),'manual');(globalThis as any).document=prior;
});
await test('Cross-Bab MOVE is deferred locally and applied only by global reconciliation with independent evidence',async()=>{
  const f=seed();f.tp.items=[{id:'t',code:'T',statement:'Mempraktikkan lempar tangkap bola.',competence:'Mempraktikkan',contentScope:'lempar tangkap bola',order:1}];f.atp.items=[{id:'a',stepNumber:1,linkedTpIds:['t']}];
  f.mapping.units=[{id:'A',title:'Permainan bola berpasangan',order:1,linkedTpIds:['t'],linkedAtpItemIds:['a'],materials:[]},{id:'B',title:'Permainan bola beregu',order:2,linkedTpIds:['t'],linkedAtpItemIds:['a'],materials:[1,2].map(n=>({id:'m'+n,title:'Mempraktikkan lempar tangkap bola.',order:n,linkedTpIds:['t'],linkedAtpItemIds:['a']}))}];
  const reviewed=applyMinimalAlignment(f.mapping.units,f.mapping.units[1].materials.map(m=>({id:'teacher-'+m.id,type:'LINK_TP',targetUnitId:'B',targetMaterialId:m.id,before:m.title,linkedTpIds:['t'],reason:'Pemetaan guru untuk permainan bola beregu.',evidence:[{tpId:'t',tpQuote:f.tp.items[0].statement,materialQuote:m.title}]})),f.atp,f.tp,'TEACHER');assert(reviewed.success,reviewed.issues.join('; '));f.mapping.units=reviewed.nextUnits!;
  const state=loadStorageV5();state.annualData.tp[0].value=f.tp;state.annualData.atp[0].value=f.atp;state.annualData.atpUnitMappings![0].value=f.mapping;saveStorageV5(state);
  const action:AlignmentAction={id:'move-one',type:'MOVE_MATERIAL',sourceUnitId:'B',targetUnitId:'A',targetMaterialId:'m1',before:f.mapping.units[1].materials[0].title,linkedTpIds:['t'],reason:'Satu latihan lempar tangkap dipakai untuk permainan berpasangan; latihan lain tetap di Bab beregu.',evidence:[{tpId:'t',tpQuote:f.tp.items[0].statement,materialQuote:f.mapping.units[1].materials[0].title}]};
  const result=await runStep07AutoRepair(options(f,{analyze:async(m,r)=>{
    if(r.phase==='VERIFY')return {summary:{} as any,atpFindings:[],materialFindings:[],step07SemanticChecks:[{actionId:action.id,verdict:'SUPPORTED',reason:action.reason,targetUnitQuote:m.units.find(u=>u.id==='A')!.title,evidence:[{tpId:'t',tpQuote:f.tp.items[0].statement,materialQuote:action.before!,competenceQuote:'Mempraktikkan',contextQuote:action.before!}]}]};
    if(!r.execution?.reconciliation)return {summary:{} as any,atpFindings:[],materialFindings:[],alignmentProposals:[{...action,id:action.id,action,before:action.before!,after:action.before!,validationStatus:'READY',tpIds:['t'],impact:{newlyCoveredTpIds:[],newlyMappedAtpIds:[]}}]};
    assert(r.execution.deferredActions?.some(a=>a.id===action.id));return sanitizeMappingAnalysisResult({alignmentProposals:[action]},{currentMapping:m,atpData:f.atp,tpData:f.tp,step07Auto:r});
  }}));
  assert(result.saved,result.issues.join('; '));assert.equal(result.mapping.units[0].materials[0].id,'m1');assert.equal(result.mapping.units[1].materials.length,1);
  assert(readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.units.A.events.some(e=>e.stage==='FILTER'&&e.reason.includes('GLOBAL_RECONCILIATION')));
});
await test('Two distinct profiles can process concurrently while V5 writes retain both mappings',async()=>{
  const f=seed(),f2=structuredClone(f),state=loadStorageV5();state.yearPlans.push({...state.yearPlans[0],id:'y2',profileId:'p2',schoolId:'s2'});
  state.workspaces.push({...state.workspaces[0],id:'w2',yearPlanId:'y2',profileId:'p2',schoolId:'s2'});
  state.semesterPlans.push(...state.semesterPlans.filter(s=>s.yearPlanId==='y').map(s=>({...s,id:'p2-'+s.id,yearPlanId:'y2'})));
  f2.tp.id='tp2';f2.tp.academicSettingId='y2';f2.atp.id='atp2';f2.atp.academicSettingId='y2';f2.atp.tpDataId='tp2';f2.mapping.id='map2';f2.mapping.academicSettingId='y2';f2.mapping.tpDataId='tp2';f2.mapping.atpId='atp2';f2.mapping.units.forEach(u=>{u.id+='-p2';u.materials.forEach(m=>m.id+='-p2');});
  state.annualData.tp.push({yearPlanId:'y2',value:f2.tp});state.annualData.atp.push({yearPlanId:'y2',value:f2.atp});state.annualData.atpUnitMappings!.push({yearPlanId:'y2',value:f2.mapping});saveStorageV5(state);
  const [a,b]=await Promise.all([runStep07AutoRepair(options(f)),runStep07AutoRepair(options(f2,{mapping:f2.mapping,persistedMapping:f2.mapping,checkpointContext:resolveStep07CheckpointContext('y2'),save:m=>{saveATPUnitMappingV5('y2',m);return true;}}))]);
  assert(a.saved,a.issues.join('; '));assert(b.saved,b.issues.join('; '));assert(resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed);assert(resolveATPUnitMappingReadiness(getATPUnitMappingV5('y2'),f2.atp,f2.tp).canProceed);
  assert.notDeepEqual(readStep07Checkpoint(resolveStep07CheckpointContext('y'))!.context,readStep07Checkpoint(resolveStep07CheckpointContext('y2'))!.context);
});
await test('Canonical/profile/manual drift while AI is running is stale and never overwrites the new source',async()=>{
  for(const changed of ['TP','PROFILE','DRAFT']){
    const f=seed(),base=provider(f);let edited=false;
    const result=await runStep07AutoRepair(options(f,{analyze:async(m,r,s)=>{
      if(!edited){edited=true;const state=loadStorageV5();if(changed==='TP')state.annualData.tp[0].value.items[0].statement+=' sumber baru';if(changed==='PROFILE')state.profiles[0].name='Nama manual baru';if(changed==='DRAFT')state.annualData.atpUnitMappings![0].value.units[0].materials[0].title='Materi manual terbaru';saveStorageV5(state);}
      return base(m,r,s);
    }}));
    assert(result.stale&&!result.saved,changed+': '+result.issues.join('; '));
    if(changed==='DRAFT')assert.equal(getATPUnitMappingV5('y')!.units[0].materials[0].title,'Materi manual terbaru');
    else assert.deepEqual(getATPUnitMappingV5('y')!.units.map(u=>u.materials.map(m=>m.title)),f.mapping.units.map(u=>u.materials.map(m=>m.title)));
  }
});
await test('ANALYZE timeout keeps legacy-complete data locked; SAVE wait timeout and unsupported locks fail closed',async()=>{
  const f=seed(),state=loadStorageV5(),legacy=structuredClone(completeFixture);delete legacy.step07AutoRepair;
  legacy.units.forEach(u=>{u.actionHistory=[];u.titleHistory=[];u.materials.forEach(m=>m.titleHistory=[]);});state.annualData.atpUnitMappings![0].value=legacy;saveStorageV5(state);
  assert(resolveATPUnitMappingReadiness(legacy,f.atp,f.tp).canProceed,'legacy compatibility before scoped analysis');
  const result=await runStep07AutoRepair(options(f,{callTimeoutMs:5,analyze:async()=>new Promise(resolve=>setTimeout(()=>resolve({summary:{} as any,atpFindings:[],materialFindings:[]}),40))}));
  assert.equal(result.outcome,'TIMEOUT');assert(!resolveATPUnitMappingReadiness(getATPUnitMappingV5('y'),f.atp,f.tp).canProceed,'checkpoint marker prevents reload bypass');
  const cp=readStep07Checkpoint(resolveStep07CheckpointContext('y'))!;assert(!Object.values(cp.units).some(p=>p.analysis));
  const key=step07CheckpointKey(resolveStep07CheckpointContext('y')),rawBefore=memory.get(key);await new Promise(r=>setTimeout(r,60));assert.equal(memory.get(key),rawBefore);
  locked.add('v22:step07:v5-write');try{await assert.rejects(withStep07StorageWrite(()=>true,5),/STEP07_TIMEOUT/);}finally{locked.delete('v22:step07:v5-write');}
  const supported=navigator.locks;Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
  try{const blocked=await runStep07AutoRepair(options(f));assert(blocked.issues.some(i=>i.includes('CHECKPOINT_LOCK_UNAVAILABLE')));assert(!blocked.saved);}finally{Object.defineProperty(navigator,'locks',{configurable:true,value:supported});}
});
console.log('PASS '+count+' hybrid checkpoint cases. Live Gemini NOT VERIFIED.');
