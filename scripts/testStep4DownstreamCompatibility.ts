import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync,writeFileSync,existsSync,readdirSync } from 'node:fs';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { jsPDF } from 'jspdf';

const root=path.resolve(process.env.CP4_BASE_ROOT || process.cwd());
const load=(file:string)=>import(pathToFileURL(path.join(root,file)).href);
const {createTwoSemesterAdministrationImportFixture}=await load('scripts/fixtures/readyAdministrationImportFixture.ts');
const storage=await load('src/services/storageV5.ts');
const workflow=await load('src/services/workflowEngine.ts');
const cpWorkflow=await load('src/services/cpWorkflowService.ts');
const mappingService=await load('src/services/atpMappingReadinessService.ts');
const executionService=await load('src/services/unitExecutionPlanService.ts');
const engine=await load('src/services/documentEngine/index.ts');
const pdf=await load('src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts');
const atpProjection=await load('src/services/documentEngine/atpDocumentProjection.ts');
const moduleProjection=await load('src/services/documentEngine/modulAjarProjection.ts');
const prota=await load('src/services/documentEngine/protaProjection.ts');
const promes=await load('src/services/documentEngine/promesProjection.ts');
const archive=await load('src/services/completeProjectZipService.ts');
const importer=await load('src/services/administrationProjectImportService.ts');
const NativeDate=Date;globalThis.Date=new Proxy(NativeDate,{construct(target,args){return Reflect.construct(target,args.length?args:['2026-10-30T00:00:00Z']);},get(target,key){return key==='now'?()=>1793318400000:Reflect.get(target,key);}});
const store=new Map<string,string>();const writeKeys:string[]=[];
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{writeKeys.push(key);store.set(key,value);}}});
const state=createTwoSemesterAdministrationImportFixture();
state.activeProfileId='p1';state.activeYearPlanId='y';state.activeWorkspaceId='w';state.activeSemesterPlanId='sp1';
storage.saveStorageV5(state);const stored=store.get(storage.STORAGE_KEY_V5);writeKeys.length=0;
const annual=(key:string)=>state.annualData[key][0]?.value;
// Execute the real main/current Step 4 callback against this existing project, with simulated AI.
const contract=await load('src/services/cpAnalysisAIContract.ts');
const draft=existsSync(path.join(root,'src/services/cpAnalysisDraft.ts'))?await load('src/services/cpAnalysisDraft.ts'):{};
const runContract=await load('src/services/cpAnalysisRun.ts');const errors=await load('src/services/cpAnalysisAIDiagnostics.ts');
const ast=ts.createSourceFile('ui.tsx',readFileSync(path.join(root,'src/components/CPAnalysisManager.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let expression='';
function visit(node:ts.Node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)==='executeAIAnalysis')expression=node.initializer!.getText(ast);ts.forEachChild(node,visit);}visit(ast);assert(expression);
const currentItems=annual('cpAnalysis').items,originalItems=JSON.stringify(currentItems);let proposed:any=null;
const bindings:any={...contract,...draft,...runContract,...errors,items:currentItems,cp:annual('cp'),aiProposal:null,context:{...state.yearPlans[0],curriculum:'Kurikulum Merdeka'},isAnalyzing:false,activeAIRequest:{current:null},requestVersion:{current:0},latestItems:{current:currentItems},
  analyzeCPWithAI:async(params:any)=>{
    const targets=params.repairTargets || params.retryTargets;
    const items=targets.map((t:any)=>{const e=params.elements.find((e:any)=>e.id===t.elementId);return {...t,elementId:e.id,elementName:e.name,cpCompetence:t.cpCompetence || e.content,materialScope:t.materialScope || e.content,suggestedTp:e.content,meaningfulUnderstanding:`Pemahaman ${e.content} berkaitan dengan ${e.content}.`};});
    return {engine:'gemini',generalSummary:'Fixture AI proposal',items,validation:contract.validateAnalysisAI({items},params.elements,params.retryTargets,params.repairTargets)};
  },setAIProposal:(value:any)=>proposed=value,onSaveCPAnalysis:()=>{throw Error('AI must not save existing project');},setItems:()=>{throw Error('AI must not replace the editor automatically');}};
for(const name of ['setNotificationToast','setIsAnalyzing','setAnalysisError','setAIDiagnosis','setApprovedSuggestions','reportAIError'])bindings[name]=()=>{};
const js=ts.transpileModule('return ('+expression+');',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
await new Function(...Object.keys(bindings),js)(...Object.values(bindings))();
assert(proposed,'Fixture must produce a reviewable AI proposal');assert.equal(JSON.stringify(currentItems),originalItems);assert.equal(store.get(storage.STORAGE_KEY_V5),stored);assert.equal(writeKeys.length,0);
const digest=(value:unknown)=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
function capture(fn:()=>unknown) {try{return {status:'ok',value:fn()};}catch(e){return {status:'blocked',message:e instanceof Error?e.message:'unknown'};}}
const result:any={annual:{},semesters:{},exports:{},restore:{}};
const allowed=new Set(['src/components/CPAnalysisManager.tsx','src/services/aiService.ts','src/services/cpAnalysisAIContract.ts','src/services/cpAnalysisAIDiagnostics.ts','src/services/cpAnalysisDraft.ts','src/services/cpAnalysisResponse.ts','server/cpAnalysisAI.ts','server/cpAnalysisDeadline.ts']);
const protectedFiles:Record<string,string>={};
function fingerprints(dir:string) {for(const entry of readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const name=dir+'/'+entry.name;if(entry.isDirectory())fingerprints(name);else if(/\.(?:ts|tsx|json)$/.test(name)&&!allowed.has(name))protectedFiles[name]=digest(readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n'));}}
fingerprints('src');fingerprints('server');fingerprints('scripts/fixtures');protectedFiles['server.ts']=digest(readFileSync(path.join(root,'server.ts'),'utf8').replace(/\r\n/g,'\n'));
result.protectedImplementations=protectedFiles;
function declarations(source:string,names:string[]) {
  const tree=ts.createSourceFile('source.tsx',source.replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const hashes:Record<string,string>={};
  function walk(node:ts.Node){if(ts.isVariableDeclaration(node)&&names.includes(node.name.getText(tree)))hashes[node.name.getText(tree)]=digest(node.getText(tree));ts.forEachChild(node,walk);}walk(tree);assert.equal(Object.keys(hashes).length,names.length);return hashes;
}
result.step4GatesAndSave=declarations(readFileSync(path.join(root,'src/components/CPAnalysisManager.tsx'),'utf8'),['handleSave','baseValidation','understandingIssues','validation','isCPOutdated','needsReview']);
const aiAST=ts.createSourceFile('aiService.ts',readFileSync(path.join(root,'src/services/aiService.ts'),'utf8').replace(/\r\n/g,'\n'),ts.ScriptTarget.Latest,true);
result.otherAIServiceFunctions={};aiAST.forEachChild(node=>{if(ts.isFunctionDeclaration(node)&&node.name&&node.name.text!=='analyzeCPWithAI')result.otherAIServiceFunctions[node.name.text]=digest(node.getText(aiAST));});
for(const key of ['cp','cpAnalysis','tp','atp','atpUnitMappings','unitExecutionPlans'])result.annual[key]=annual(key);
result.gates={cp:cpWorkflow.validateCPDataWorkflow(annual('cp')),analysis:cpWorkflow.validateCPAnalysisDataWorkflow(annual('cpAnalysis'),annual('cp')),tp:cpWorkflow.validateTPDataWorkflow(annual('tp'),annual('cp'),annual('cpAnalysis')),atp:cpWorkflow.validateATPDataWorkflow(annual('atp'),annual('tp'),undefined,annual('cp'),annual('cpAnalysis')),mapping:mappingService.resolveATPUnitMappingReadiness(annual('atpUnitMappings'),annual('atp'),annual('tp')),execution:executionService.validateUnitExecutionPlan(annual('unitExecutionPlans'),annual('atpUnitMappings'),annual('atp'),annual('tp'))};
let pdfText:string[]=[];
const hook=['initialized',function(this:any){const original=this.text;this.text=function(text:any,...args:any[]){pdfText.push(...(Array.isArray(text)?text.flat(3):[text]).map(String));return original.call(this,text,...args);};}];
(jsPDF.API.events as any[]).push(hook);
try {
  for(const semester of state.semesterPlans) {
    const sem=(key:string)=>state.semesterData[key]?.find((row:any)=>row.semesterPlanId===semester.id)?.value;
    const setting={...state.yearPlans[0],id:semester.id,semester:semester.semester===1?'1 (Ganjil)':'2 (Genap)',curriculum:'Kurikulum Merdeka',updatedAt:state.yearPlans[0].updatedAt};
    const context:any={profile:state.profiles[0],school:state.schools[0],workspace:state.workspaces[0],academicSetting:setting,cp:annual('cp'),cpAnalysis:annual('cpAnalysis'),tp:annual('tp'),atp:annual('atp'),atpUnitMapping:annual('atpUnitMappings'),unitExecutionPlan:annual('unitExecutionPlans'),
      learningMeetingSchedules:state.semesterData.learningMeetingSchedules.map((r:any)=>({semesterPlanId:r.semesterPlanId,semester:r.semesterPlanId==='sp1'?1:2,schedule:r.value})),
      learningPlans:sem('learningPlan'),activeLearningPlanId:sem('learningPlan')[0].id,assessmentCriteria:sem('assessmentCriteria'),assessmentPlans:sem('assessmentPlan'),assessmentPackages:sem('assessmentPackage'),
      calendar:sem('academicCalendar').calendar,calendarDays:sem('academicCalendar').days,timeAllocations:sem('timeAllocation'),semesterJPSetting:state.semesterJPSettings.find((r:any)=>r.semesterPlanId===semester.id)?.value,
      annualJPReference:state.annualJPReferences?.[0]?.value,subjectWeeklySchedule:sem('subjectWeeklySchedules'),documentDate:'2026-10-30',skipDownload:true,
      protaSemesterAllocations:state.semesterPlans.map((s:any)=>({semester:s.semester,semesterPlanId:s.id,academicSetting:{...setting,id:s.id,semester:String(s.semester)},timeAllocations:state.semesterData.timeAllocation.find((r:any)=>r.semesterPlanId===s.id)?.value || []}))};
    result.semesters[semester.id]={workflow:workflow.validateWorkflowDependencies({...context,assessments:[],assessmentResults:[],remedials:[],enrichments:[]}),atp:capture(()=>atpProjection.buildATPDocumentProjection(context)),prota:capture(()=>prota.buildProtaProjection(context)),promes:capture(()=>promes.buildPromesProjection(context)),module:capture(()=>moduleProjection.buildModulAjarProjection(context)),data:state.semesterData};
    for(const type of ['CP','ANALISIS_CP_TP','TP','ATP','PEMETAAN_ATP_UNIT','PROTA','PROMES','MODUL_AJAR']) {
      const key=semester.id+'/'+type;const output:any={requirements:engine.validateDocumentRequirements(type,context)};
      try {
        const doc=await engine.generateDocument(type,context);assert(doc.success&&doc.blob);
        const zip=await JSZip.loadAsync(await doc.blob.arrayBuffer());const xml=await zip.file('word/document.xml')!.async('string');
        const text=[...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(m=>m[1]);assert(text.length);
        output.docx={status:'ok',textHash:digest(text),textCount:text.length};
      } catch(e) {output.docx={status:'blocked',message:e instanceof Error?e.message:'unknown'};}
      try {pdfText=[];await pdf.generatePdfDocument(type,context);assert(pdfText.length,'PDF instrumentation must capture actual text calls');output.pdf={status:'ok',textHash:digest(pdfText),textCount:pdfText.length};}
      catch(e) {output.pdf={status:'blocked',message:e instanceof Error?e.message:'unknown'};}
      result.exports[key]=output;
    }
  }
  const packaged=await archive.readCompleteProjectZip(await archive.createCompleteProjectZip(state,'y'));
  const restored=importer.prepareCompleteAdministrationProjectImport(state,packaged,{mode:'RESTORE',targetProfileId:'p1',targetSchoolId:'s1',replaceYearPlanId:'y'});
  for(const key of ['cp','cpAnalysis','tp','atp','atpUnitMappings','unitExecutionPlans'])assert.deepEqual(restored.state.annualData[key][0].value,annual(key));
  result.restore={status:'ok',annualHash:digest(restored.state.annualData),sourceUntouched:true};
  assert(!writeKeys.includes(storage.STORAGE_KEY_V5),'Exports may record their existing diagnostics, but must not write project storage');assert.equal(store.get(storage.STORAGE_KEY_V5),stored);assert.deepEqual(storage.loadStorageV5(),state);
  result.storageHash=digest(stored);result.exportDiagnosticWriteCount=writeKeys.length;
} finally {(jsPDF.API.events as any[]).splice((jsPDF.API.events as any[]).indexOf(hook),1);globalThis.Date=NativeDate;}
const out=process.env.CP4_SNAPSHOT_OUT;if(out)writeFileSync(out,JSON.stringify(result,null,2));
if(process.env.CP4_SNAPSHOT_BASELINE)assert.deepEqual(JSON.parse(JSON.stringify(result)),JSON.parse(readFileSync(process.env.CP4_SNAPSHOT_BASELINE,'utf8')),'Step 3–10 data, gates, projections, DOCX/PDF substance and restore must match actual main');
console.log('PASS Step 3–10 existing two-semester fixture: stable annual/semester data, gates, projections, storage/reload and ZIP RESTORE.');
console.log(`Protected source fingerprints: ${Object.keys(protectedFiles).length}; Step 4 save/gates and non-Step-4 AI functions compared verbatim.`);
for(const [key,value] of Object.entries(result.exports) as [string,any][])console.log(`${key}: DOCX ${value.docx.status}, PDF ${value.pdf.status}`);
if(process.env.CP4_SNAPSHOT_BASELINE)console.log('PASS: all downstream results and actual exported text hashes identical to main for identical Step 4 input.');
