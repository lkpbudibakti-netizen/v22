import { withCP4Health } from './fixtures/cp4BackendHealth';
import assert from 'node:assert/strict';
import { analyzeCPWithAI } from '../src/services/aiService';
import { parseCP4JSON, CP4ResponseError } from '../src/services/cpAnalysisResponse';
import { formatCPAnalysisDiagnosis, createCPAnalysisDiagnosis } from '../src/services/cpAnalysisAIDiagnostics';
import { validateAnalysisAI } from '../src/services/cpAnalysisAIContract';
import { validateCP4Input, inspectCP4Draft, planCP4Repair, stageCP4Proposal, applyCP4Proposal, cp4Coverage } from '../src/services/cpAnalysisDraft';
import { handleCPAnalysisAI,buildCPAnalysisRequest } from '../server/cpAnalysisAI';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mergeCP4Structure } from '../src/services/cpAnalysisDraft';
import { CPAnalysisAIError } from '../src/services/cpAnalysisAIDiagnostics';
import { newCP4RequestId,initialCP4Trace } from '../src/services/cpAnalysisRun';
import { cp4ElementStatuses } from '../src/services/cpAnalysisDraft';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CPAnalysisManager,CP4ElementProgress } from '../src/components/CPAnalysisManager';
import { EventEmitter } from 'node:events';
import { serveCP4Analysis } from '../server/cpAnalysisDeadline';

const phase=process.argv[2] || 'p0';
export const elements=[{id:'e1',name:'Bilangan',code:'E1',content:'Murid membandingkan nilai pecahan; murid menjelaskan hubungan bilangan pecahan.'},{id:'e2',name:'Gerak',code:'E2',content:'Murid mempraktikkan koordinasi gerak dan keseimbangan tubuh.'}];
export const input={cpText:'',elements,subject:'Matematika',phase:'D',grade:'Kelas 7',curriculum:'Kurikulum Merdeka'};
export const payload={generalSummary:'Analisis CP.',items:elements.map((e,index)=>({elementId:e.id,elementName:e.name,scopeCode:index?'GR':'BP',cpCompetence:index?'Mempraktikkan':'Membandingkan dan menjelaskan',materialScope:e.name,meaningfulUnderstanding:index?'Koordinasi gerak berkaitan dengan keseimbangan tubuh.':'Membandingkan nilai pecahan berkaitan dengan hubungan bilangan pecahan.',suggestedTp:e.content}))};
if(phase==='p0') {
  const original=globalThis.fetch;
  try {
    for(const [status,mime,text,code,reason] of [
      [200,'text/html','<html>SECRET</html>','RESPONSE_INVALID','HTML'],
      [200,'application/json','<h1>SECRET</h1>','RESPONSE_INVALID','HTML'],
      [503,'text/html','<html>SECRET</html>','AI_API_ERROR','HTML'],
      [200,'text/plain',JSON.stringify({data:payload}),'RESPONSE_INVALID','CONTENT_TYPE'],
      [200,'application/json','','RESPONSE_INVALID','EMPTY'],
      [200,'application/json','{"data":{"items":[','RESPONSE_INVALID','TRUNCATED'],
      [200,'application/json','{"data":{"items":[{"elementId":"e1"}]','RESPONSE_INVALID','TRUNCATED'],
      [200,'application/json','{"items":[}}','RESPONSE_INVALID','JSON_SYNTAX'],
      [200,'application/json','```json\n{"items":[]}\n```','RESPONSE_INVALID','JSON_SYNTAX'],
      [200,'application/json','[]','RESPONSE_INVALID','CONTRACT'],
      [200,'application/json','{"items":[]}','RESPONSE_INVALID','CONTRACT'],
    ] as const) {
      globalThis.fetch=withCP4Health(async()=>new Response(text,{status,headers:{'Content-Type':mime}}));
      await assert.rejects(()=>analyzeCPWithAI(input),(error:any)=> {
        assert.equal(error.code,code);assert.equal(error.responseInfo.reason,reason);assert.equal(error.responseInfo.httpStatus,status);
        const report=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,2,error.code,error.stage,[],error.trace,error.responseInfo));
        assert(!report.includes('SECRET'));assert(report.includes(reason));return true;
      });
    }
    for(const mime of ['application/json','application/problem+json']) {
      globalThis.fetch=withCP4Health(async()=>new Response(JSON.stringify({data:payload,engine:'gemini'}),{headers:{'Content-Type':mime}}));
      assert((await analyzeCPWithAI(input)).validation!.valid);
    }
    for(const [text,reason] of [['<html>SECRET</html>','HTML'],['{"items":[','TRUNCATED'],['{}','CONTRACT'],['','EMPTY']] as const) {
      assert.throws(()=>parseCP4JSON(text,{source:'provider'}),(e:any)=>e instanceof CP4ResponseError&&e.info.source==='provider'&&e.info.reason===reason);
    }
    assert.deepEqual(parseCP4JSON('```json\n'+JSON.stringify(payload)+'\n```',{source:'provider'}),payload);
    const requestId=newCP4RequestId();
    const req:any=Object.assign(new EventEmitter(),{body:input,aborted:false,get:(key:string)=>key==='X-CP4-Request-ID'?requestId:key==='X-CP4-Deadline'?String(Date.now()+80000):undefined});
    const res:any=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,status(code:number){this.statusCode=code;return this;},json(body:any){this.body=body;this.writableEnded=true;return this;}});
    await serveCP4Analysis(req,res,'fixture-key',async()=>({text:'{"items":[{"elementId":"e1"}]'}));
    assert.equal(res.statusCode,502);assert.equal(res.body.responseInfo.source,'provider');assert.equal(res.body.responseInfo.reason,'TRUNCATED');assert.equal(res.body.trace.attempt,1);assert.equal(res.body.trace.requestId,requestId);
  } finally {globalThis.fetch=original;}
  console.log('PASS P0: HTTP status/mime, HTML, empty/truncated/malformed JSON, output contract, provider parser and safe diagnosis.');
}
if(phase==='p3') {
  const rows=stageCP4Proposal([],[],validateAnalysisAI(payload,elements),elements,'full','').items;
  let statuses=cp4ElementStatuses(rows,elements);assert(statuses.every(e=>e.status==='Siap'));
  statuses=cp4ElementStatuses([{...rows[0],meaningfulUnderstanding:''},rows[1]],elements);assert.equal(statuses[0].status,'Gagal');assert.equal(statuses[1].status,'Siap');
  statuses=cp4ElementStatuses([{...rows[0],meaningfulUnderstanding:'Bilangan pecahan berkaitan dengan orbit planet.'},rows[1]],elements);assert.equal(statuses[0].status,'Perlu ditinjau');assert.equal(statuses[1].status,'Siap');
  const markup=renderToStaticMarkup(React.createElement(CP4ElementProgress,{rows:statuses,busy:true,activeIds:['e1'],onRepair:()=>{}}));
  assert(markup.includes('Memproses'));assert(markup.includes('Siap'));assert(markup.includes('disabled'));assert(markup.includes('Status analisis per elemen'));
  const full=renderToStaticMarkup(React.createElement(CPAnalysisManager,{cp:{id:'cp',academicSettingId:'year',generalDescription:'',elements,updatedAt:'2026-01-01'},context:{...input,profileId:'p',schoolId:'s',academicYear:'2026/2027',semester:'1',level:'SMP',curriculumType:'KURIKULUM_MERDEKA'},academicSetting:{...input,id:'year',academicYear:'2026/2027',semester:'1',level:'SMP',updatedAt:'2026-01-01'},profile:{id:'p',name:'Fixture',nip:'',status:'PNS',schoolId:'s',defaultSubject:'Matematika',defaultLevel:'SMP',createdAt:'2026-01-01',updatedAt:'2026-01-01'},onSaveCPAnalysis:()=>{throw Error('render must not save');},onNextStep:()=>{},onBackToCP:()=>{}} as any));
  for(const label of ['Analisis Ulang Seluruh CP','Perbaiki Hasil Bermasalah','Tarik dari Elemen CP','Status hasil per elemen'])assert(full.includes(label),label);
  const report=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,2,'VALIDATION_FAILED','validation',[{elementId:'e1',field:'meaningfulUnderstanding',code:'MU_EMPTY',category:'structure'},{elementId:'e2',field:'coverage',code:'CP_COVERAGE_REVIEW',category:'quality'}]));
  assert(report.includes('structure'));assert(report.includes('quality'));assert(!report.includes(elements[0].content));
  const ids=formatCPAnalysisDiagnosis(createCPAnalysisDiagnosis(input,2,'VALIDATION_FAILED','validation',[{elementId:'elem-1793318400000',itemId:'ana-item-1793318400000',field:'items',code:'ELEMENT_MISSING'},{elementId:'08123456789',field:'items',code:'ELEMENT_MISSING'},{elementId:'teacher@example.com',field:'items',code:'ELEMENT_MISSING'}]));
  assert(ids.includes('elem-1793318400000'));assert(ids.includes('ana-item-1793318400000'));assert(!ids.includes('08123456789'));assert(!ids.includes('teacher@example.com'));
  console.log('PASS P3: full component SSR, distinct actions, per-element ready/review/failure and active progress, disabled concurrent retry, diagnosis categories.');
}
function callback(name:string,bindings:Record<string,any>) {
  const ast=ts.createSourceFile('CPAnalysisManager.tsx',readFileSync('src/components/CPAnalysisManager.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression='';
  function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)expression=node.initializer!.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(expression,name);
  const js=ts.transpileModule('return ('+expression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  return new Function(...Object.keys(bindings),js)(...Object.values(bindings));
}
if(phase==='p2') {
  const rows=stageCP4Proposal([],[],validateAnalysisAI(payload,elements),elements,'full','').items;
  rows[0].id='existing-id';rows[0].cpCompetence='Manual competence';rows[0].meaningfulUnderstanding='Manual understanding retained';
  const before=JSON.stringify(rows),fullPlan=planCP4Repair(rows,elements,'full');
  const checked=validateAnalysisAI({items:fullPlan.targets.map(t=>({...t,cpCompetence:'AI competence',meaningfulUnderstanding:payload.items[elements.findIndex(e=>e.id===t.elementId)].meaningfulUnderstanding}))},elements,[],fullPlan.targets);
  const proposed=stageCP4Proposal(rows,fullPlan.items,checked,elements,'full','AI summary',fullPlan.targets);
  assert.equal(proposed.items[0].id,'existing-id');assert.equal(proposed.items[0].cpCompetence,'Manual competence');assert(proposed.suggestions.length);
  assert.deepEqual(applyCP4Proposal(rows,proposed),rows);
  const applied=applyCP4Proposal(rows,proposed,new Set(['existing-id:cpCompetence']))!;
  assert.equal(applied[0].cpCompetence,'AI competence');assert.equal(applied[0].meaningfulUnderstanding,rows[0].meaningfulUnderstanding);assert.equal(applied[0].id,rows[0].id);
  assert.equal(applyCP4Proposal([{...rows[0],materialScope:'Concurrent edit'},rows[1]],proposed),null);assert.equal(JSON.stringify(rows),before);
  let metadataWrites=0;
  callback('handleApplyAIProposal',{items:rows,aiProposal:proposed,isAnalyzing:false,approvedSuggestions:new Set(),applyCP4Proposal,setAIProposal:()=>{},setNotificationToast:()=>{},setItems:()=>{throw Error('Unapproved proposals must be a no-op');},setAIDraftEngine:()=>metadataWrites++,setHasUnsavedChanges:()=>metadataWrites++})();
  assert.equal(metadataWrites,0,'No-op apply must not change provenance/dirty metadata');
  const state:any={items:rows,saves:0,confirm:false,proposal:null,errors:[]};
  const bindings:any={items:rows,cp:{elements,generalDescription:''},cpAnalysis:{items:rows,id:'old-analysis',needsReview:true},isAnalyzing:false,activeAIRequest:{current:null},validateCP4Input,mergeCP4Structure,
    setItems:(value:any)=>state.items=value,setShowStructureConfirm:(value:boolean)=>state.confirm=value,setHasUnsavedChanges:()=>{},setIsReviewStale:()=>{},setAIProposal:(value:any)=>state.proposal=value,setNotificationToast:()=>{},onSaveCPAnalysis:()=>state.saves++,reportAIError:(...args:any[])=>state.errors.push(args)};
  callback('handleGenerateFromCP',bindings)();assert(state.confirm);assert.equal(state.saves,0);assert.deepEqual(state.items,rows);
  callback('handleGenerateFromCP',bindings)(true);assert.deepEqual(state.items,rows);assert.equal(state.saves,0);assert.equal(bindings.cpAnalysis.needsReview,true);
  const one=[rows[0]],merged=mergeCP4Structure(one,elements);assert.deepEqual(merged[0],one[0]);assert.equal(merged[1].elementId,'e2');assert.equal(JSON.stringify(rows),before);
  let resolve:(value:any)=>void=()=>{},calls=0;
  Object.assign(bindings,{context:input,aiProposal:null,requestVersion:{current:0},latestItems:{current:rows},planCP4Repair,stageCP4Proposal,validateAnalysisAI,CPAnalysisAIError,newCP4RequestId,initialCP4Trace,
    setIsAnalyzing:()=>{},setAnalysisError:()=>{},setAIDiagnosis:()=>{},setApprovedSuggestions:()=>{},analyzeCPWithAI:async()=>{calls++;return new Promise(r=>resolve=r);}});
  const execute=callback('executeAIAnalysis',bindings),job=execute(undefined,'full');await execute(undefined,'full');assert.equal(calls,1);assert.equal(state.saves,0);
  bindings.activeAIRequest.current.controller.abort();resolve({validation:checked});await job;assert.equal(state.proposal,null);assert.equal(state.saves,0);assert.equal(state.errors[0][0],'AI_ABORTED');assert.deepEqual(state.items,rows);
  const initialBindings={...bindings,items:[],latestItems:{current:[]},activeAIRequest:{current:null},requestVersion:{current:0},analyzeCPWithAI:async()=>({validation:validateAnalysisAI({...payload,items:[{...payload.items[0],meaningfulUnderstanding:''},payload.items[1]]},elements),engine:'gemini'})};
  await callback('executeAIAnalysis',initialBindings)(undefined,'full');assert.equal(state.proposal.items[1].meaningfulUnderstanding,payload.items[1].meaningfulUnderstanding);assert.equal(state.saves,0);
  let sent:any;const partialProposal=state.proposal;
  const partialPlan=planCP4Repair(partialProposal.items,elements,'repair');
  await callback('executeAIAnalysis',{...initialBindings,aiProposal:partialProposal,analyzeCPWithAI:async(params:any)=>{sent=params;return {validation:validateAnalysisAI({items:partialPlan.targets.map(t=>({...t,meaningfulUnderstanding:payload.items[0].meaningfulUnderstanding}))},[elements[0]],[],partialPlan.targets),engine:'gemini'};}})();
  assert.equal(sent.elements.length,1);assert.equal(sent.elements[0].id,'e1');assert.deepEqual(sent.repairTargets[0].fields,['meaningfulUnderstanding']);assert.equal(state.proposal.items[1].meaningfulUnderstanding,partialProposal.items[1].meaningfulUnderstanding);assert.equal(state.saves,0);
  const effectAST=ts.createSourceFile('ui.tsx',readFileSync('src/components/CPAnalysisManager.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let resetExpression='';
  function findReset(node:ts.Node){if(ts.isCallExpression(node)&&node.expression.getText(effectAST)==='useEffect'&&node.arguments[0]?.getText(effectAST).includes('const cancel='))resetExpression=node.arguments[0].getText(effectAST);ts.forEachChild(node,findReset);}findReset(effectAST);assert(resetExpression);
  const controller=new AbortController(),ref:any={current:{controller}},version={current:0},reset:any={};
  const resetBindings:any={activeAIRequest:ref,requestVersion:version};for(const key of ['setIsAnalyzing','setShowStructureConfirm','setShowConfirmModal','setApprovedSuggestions','setAIProposal','setAIDraftEngine','setAIDiagnosis','setAnalysisError','setManualDiagnosisCopy','setCopyStatus'])resetBindings[key]=(value:any)=>reset[key]=value;
  const resetJS=ts.transpileModule('return ('+resetExpression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const cleanup=new Function(...Object.keys(resetBindings),resetJS)(...Object.values(resetBindings))();assert(controller.signal.aborted);assert.equal(ref.current,null);assert.equal(reset.setShowConfirmModal,false);assert.equal(reset.setShowStructureConfirm,false);assert.equal(reset.setAIProposal,null);
  const unmount=new AbortController();ref.current={controller:unmount};cleanup();assert(unmount.signal.aborted);assert.equal(state.saves,0);
  console.log('PASS P2: explicit field consent, stable IDs, full reanalysis, safe structure confirmation/draft only, duplicate/abort protection and partial repair without repeating valid elements.');
}
if(phase==='p1') {
  for(const bad of [[],[null],[{...elements[0],content:' '}],[elements[0],elements[0]]])assert(validateCP4Input(bad).length);
  let calls=0;const original=globalThis.fetch;
  try {globalThis.fetch=withCP4Health(async()=>{calls++;throw Error('must not send');});await assert.rejects(()=>analyzeCPWithAI({...input,elements:[{...elements[0],content:''}]}),(e:any)=>e.code==='CP_INPUT_INVALID');assert.equal(calls,0);} finally {globalThis.fetch=original;}
  assert.equal((await handleCPAnalysisAI({...input,elements:[{...elements[0],name:' '}]})).status,400);
  const multi={...payload,items:[{...payload.items[0],cpCompetence:'Membandingkan',suggestedTp:'Murid membandingkan nilai pecahan.'},{...payload.items[0],cpCompetence:'Menjelaskan',suggestedTp:'Murid menjelaskan hubungan bilangan pecahan.'},payload.items[1]]};
  const full=await handleCPAnalysisAI(input,async()=>multi);assert(full.body.validation!.valid);assert.equal(full.body.data!.items.length,3);
  const incomplete=await handleCPAnalysisAI(input,async()=>({...payload,items:[{...payload.items[0],suggestedTp:'Murid membandingkan nilai pecahan.',meaningfulUnderstanding:'Nilai pecahan membantu membandingkan nilai pecahan.',cpCompetence:'Membandingkan',materialScope:'Nilai pecahan'},payload.items[1]]}));
  assert(incomplete.body.validation!.issues.some(i=>i.code==='CP_COVERAGE_REVIEW'&&i.elementId==='e1'&&i.category==='quality'));
  assert.equal(incomplete.body.validation!.items.length,2,'Coverage findings must not discard the other element');
  const checked=validateAnalysisAI({...payload,items:[{...payload.items[0],meaningfulUnderstanding:''},payload.items[1]]},elements);
  assert(checked.issues.some(i=>i.code==='MU_EMPTY'&&i.category==='structure'));
  const proposal=stageCP4Proposal([],[],checked,elements,'full','');assert.equal(proposal.items[1].meaningfulUnderstanding,payload.items[1].meaningfulUnderstanding);
  const plan=planCP4Repair(proposal.items,elements,'repair');assert.equal(plan.targets.length,1);assert.deepEqual(plan.targets[0].fields,['meaningfulUnderstanding']);
  assert.equal(plan.targets[0].elementId,'e1');assert.equal(plan.items[0].id,proposal.items[0].id);
  const fixed=await handleCPAnalysisAI({...input,elements:[elements[0]],repairTargets:plan.targets},async()=>({items:plan.targets.map(t=>({...t,meaningfulUnderstanding:payload.items[0].meaningfulUnderstanding,materialScope:'Injected replacement'}))}));
  assert(fixed.body.validation!.valid);assert.equal(fixed.body.data!.items[0].materialScope,plan.targets[0].materialScope);
  const ready=stageCP4Proposal([],plan.items,fixed.body.validation!,elements,'repair','',plan.targets);
  assert.equal(ready.items[0].meaningfulUnderstanding,payload.items[0].meaningfulUnderstanding);assert.deepEqual(ready.items[1],proposal.items[1]);
  const missing=stageCP4Proposal([],[],validateAnalysisAI({items:[payload.items[1]]},elements),elements,'full','');
  const missingPlan=planCP4Repair(missing.items,elements,'repair','e1');assert(missingPlan.targets.every(t=>t.elementId==='e1'));
  const covered=proposal.items.map(i=>({...i}));covered[0].cpCompetence='Membandingkan';covered[0].materialScope='Nilai pecahan';covered[0].suggestedTp='Murid membandingkan nilai pecahan.';covered[0].meaningfulUnderstanding='Nilai pecahan membantu membandingkan nilai pecahan.';
  assert(cp4Coverage(covered,elements).length);const clauses=planCP4Repair(covered,elements,'repair');assert(clauses.targets.some(t=>t.clauseText?.includes('menjelaskan')));
  const compound={id:'compound',name:'Bilangan',code:'E3',content:'Murid membandingkan nilai pecahan biasa campuran desimal positif negatif serta menjelaskan hubungan bilangan pecahan.'};
  assert(cp4Coverage([{elementId:'compound',cpCompetence:'Membandingkan',materialScope:'nilai pecahan biasa campuran desimal positif negatif hubungan bilangan pecahan',suggestedTp:'Murid membandingkan nilai pecahan biasa campuran desimal positif negatif.'}],[compound]).length,'High token overlap must not hide an omitted CP competence verb');
  assert.equal((await handleCPAnalysisAI({...input,repairTargets:[{...plan.targets[0],fields:['not-a-field']}]})).status,400);
  assert(inspectCP4Draft(missing.items,elements).some(i=>i.category==='structure'));
  const unsupported=proposal.items.map((row,index)=>index?row:{...row,meaningfulUnderstanding:payload.items[0].meaningfulUnderstanding,materialScope:'Orbit planet galaksi'});
  const source={id:'cp',academicSettingId:'year',generalDescription:'',elements,updatedAt:'2026-01-01'};
  assert(inspectCP4Draft(unsupported,elements,source).some(i=>i.code==='PEDAGOGY_REVIEW'&&i.field==='materialScope'&&i.itemId===unsupported[0].id));
  assert(planCP4Repair(unsupported,elements,'repair','e1',source).targets.some(t=>t.fields.includes('materialScope')));
  assert(buildCPAnalysisRequest({...input,repairTargets:plan.targets}).contents.includes('PERBAIKAN TERARAH'));
  console.log('PASS P1: preflight input, multiple rows per element, per-clause quality vs structure, valid partial retained and targeted field/element/clause repair.');
}
