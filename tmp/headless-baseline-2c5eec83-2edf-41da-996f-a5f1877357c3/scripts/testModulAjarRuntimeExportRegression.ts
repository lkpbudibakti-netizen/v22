import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveBuildIdentity } from './buildIdentity';
import { createModulAjarRuntimeFixture } from './fixtures/modulAjarRuntimeFixture';
import { createRuntimeUpdateMonitor } from '../src/services/runtimeUpdateService';

const identity = resolveBuildIdentity(process.cwd());
assert.equal(identity.buildSha,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
assert(identity.buildId.includes(identity.buildSha));
(globalThis as any).__APP_BUILD_SHA__=identity.buildSha;
(globalThis as any).__APP_BUILD_ID__=identity.buildId;
(globalThis as any).__APP_BUILD_DIRTY__=identity.buildDirty;
const { prepareModulAjarExportContext }=await import('../src/services/documentEngine/modulAjarExportContext');
const { createDocumentSnapshot }=await import('../src/services/documentEngine/snapshot');
const { generateModulAjar,MODUL_AJAR_RENDERER_VERSION }=await import('../src/services/documentEngine/generators/modulAjarGenerator');
const { getLastModulAjarExportDiagnostic }=await import('../src/services/documentEngine/modulAjarExportDiagnostics');
const { default:JSZip }=await import('jszip');

// Exercise the actual Vite identity injection/manifest hooks without a build or loading unrelated plugins.
const configSource=readFileSync('vite.config.ts','utf8');
const configExports:any={};let pwaOptions:any;
runInNewContext(ts.transpileModule(configSource.slice(configSource.indexOf('export default defineConfig')),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{exports:configExports,defineConfig:(factory:any)=>factory(),resolveBuildIdentity:()=>identity,
  __dirname:process.cwd(),react:()=>({}),tailwindcss:()=>({}),VitePWA:(options:any)=>{pwaOptions=options;return {};},
  path:{resolve:()=>process.cwd()},process:{env:{}},
});
const config=configExports.default;
assert.equal(JSON.parse(config.define.__APP_BUILD_SHA__),identity.buildSha);
let manifest:any;
const identityPlugin=config.plugins.find((plugin:any)=>plugin.name==='runtime-build-identity');
identityPlugin.generateBundle.call({emitFile:(asset:any)=>{manifest=asset;}});
assert.deepEqual(JSON.parse(manifest.source),identity);
assert.equal(manifest.fileName,'build-info.json');
let middleware:any;identityPlugin.configureServer({middlewares:{use:(_path:any,handler:any)=>{middleware=handler;}}});
const headers:any={};let body='';middleware({}, {setHeader:(key:string,value:string)=>headers[key]=value,end:(value:string)=>body=value});
assert.equal(headers['Cache-Control'],'no-store');assert.equal(JSON.parse(body).buildSha,identity.buildSha);
assert.equal(pwaOptions.registerType,'prompt');assert.equal(pwaOptions.injectRegister,false);
assert.equal(pwaOptions.workbox.skipWaiting,false);
assert(pwaOptions.workbox.globIgnores.includes('**/build-info.json'));
assert(pwaOptions.workbox.navigateFallbackDenylist.some((rule:RegExp)=>rule.test('/build-info.json')));

const context=createModulAjarRuntimeFixture();
const oldPlan={...structuredClone(context.learningPlans[0]),id:'lp-old',updatedAt:'2026-10-16T00:00:00Z'};
context.learningPlans[0].learningSteps.core.find((step:any)=>step.learningMeetingId==='m1').durationMinutes=55;
context.learningPlans[0].learningSteps.core.push({id:'extra',learningMeetingId:'m1',description:'Aktivitas live terbaru',durationMinutes:5});
context.learningPlans.push(oldPlan);
const historical=createDocumentSnapshot({...context,activeLearningPlanId:'lp-old'},'docx','data','MODUL_AJAR');
historical.schoolName='Sekolah Lama';historical.generatedAt='2026-10-16T10:00:00Z';
context.school.name='Sekolah Terbaru';context.snapshot=historical;
const original=JSON.stringify(context);
const live=prepareModulAjarExportContext(context,'docx');
assert.equal(live.school.name,'Sekolah Terbaru');
assert.equal(live.snapshot!.learningPlanId,'lp');
assert.notEqual(live.snapshot, historical);
assert.notEqual(live.snapshot!.generatedAt,historical.generatedAt);
const currentFile=await generateModulAjar({...live,skipDownload:true});
const receipt=getLastModulAjarExportDiagnostic()!;
assert.equal(receipt.buildSha,identity.buildSha);
assert.equal(receipt.modulAjarRendererVersion,MODUL_AJAR_RENDERER_VERSION);
assert.equal(receipt.selectedLearningPlanId,'lp');assert.equal(receipt.snapshotLearningPlanId,'lp');
assert.equal(receipt.meetingCount,3);assert.equal(receipt.meetingsWithActivities,3);assert.equal(receipt.totalMeetingActivities,10);
const liveXml=await (await JSZip.loadAsync(await currentFile.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
assert(liveXml.includes('Sekolah Terbaru') && liveXml.includes('Aktivitas live terbaru'));
const oldContext=prepareModulAjarExportContext(context,'docx','snapshot',historical);
assert.equal(oldContext.snapshot,historical);assert.equal(oldContext.activeLearningPlanId,'lp-old');
const oldFile=await generateModulAjar({...oldContext,skipDownload:true});
const oldXml=await (await JSZip.loadAsync(await oldFile.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
assert(oldXml.includes('Sekolah Lama') && !oldXml.includes('Aktivitas live terbaru'));
assert.equal(getLastModulAjarExportDiagnostic()!.selectedLearningPlanId,'lp-old');
assert.equal(getLastModulAjarExportDiagnostic()!.snapshotLearningPlanId,'lp-old');
assert.equal(getLastModulAjarExportDiagnostic()!.totalMeetingActivities,9);
assert.equal(JSON.stringify(context),original);
assert.throws(()=>prepareModulAjarExportContext(context,'docx','snapshot'),/belum tersedia/);
assert.throws(()=>prepareModulAjarExportContext(context,'docx','snapshot',{...historical,learningPlanId:undefined}),/lineage LearningPlan/);
assert.throws(()=>prepareModulAjarExportContext(context,'docx','snapshot',{
  ...historical, sourceVersions:{...historical.sourceVersions,learningPlanUpdatedAt:'changed'},
}),/LearningPlan historis exact.*tidak tersedia/);
const sameIdSnapshot = {...historical,learningPlanId:'lp'};
assert.throws(()=>prepareModulAjarExportContext(context,'docx','snapshot',sameIdSnapshot),/LearningPlan historis exact.*tidak tersedia/);
assert.throws(()=>prepareModulAjarExportContext({...context,learningPlans:[]},'docx','snapshot',historical),/LearningPlan historis exact.*tidak tersedia/);
// Synthetic test fixture supplies both existing revisions with the same ID.
const exactRevision = {...oldPlan,id:'lp'};
const revisions = {...context,learningPlans:[context.learningPlans[0],exactRevision]};
const exactContext = prepareModulAjarExportContext(revisions,'docx','snapshot',sameIdSnapshot);
assert.equal(exactContext.learningPlans!.length,1);
assert.equal(exactContext.learningPlans![0],exactRevision); // Existing reference, no reconstructed historical state.
const exactFile = await generateModulAjar({...exactContext,skipDownload:true});
const exactXml = await (await JSZip.loadAsync(await exactFile.blob!.arrayBuffer())).file('word/document.xml')!.async('string');
assert(exactXml.includes('Sekolah Lama') && !exactXml.includes('Aktivitas live terbaru'));
const sameIdLive = prepareModulAjarExportContext(revisions,'docx');
assert.equal(sameIdLive.snapshot!.learningPlanId,'lp');
assert.equal(sameIdLive.snapshot!.sourceVersions!.learningPlanUpdatedAt,context.learningPlans[0].updatedAt);
assert.equal(sameIdLive.school.name,'Sekolah Terbaru');
assert.throws(()=>prepareModulAjarExportContext({...context,learningPlans:[exactRevision,exactRevision]},'docx','snapshot',sameIdSnapshot),/ambigu/);

// Execute the real download action with actual DOCX generation; historical mode must not overwrite the record.
const ui=readFileSync('src/components/AdminDocsExport.tsx','utf8');
const handlerSource=ui.slice(ui.indexOf('  const handleGenerateSingleDoc ='),ui.indexOf('  const handleExportZipBundle ='))
  .replace('  const handleGenerateSingleDoc =','  export const handleGenerateSingleDoc =');
const handlerExports:any={};let record:any={id:'existing',type:'MODUL_AJAR',snapshot:historical};let saves=0;let error:any;
runInNewContext(ts.transpileModule(handlerSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:handlerExports,context,workspace:{id:'workspace'},academicSetting:context.academicSetting,documentMode:'data',
  getDocRecord:()=>record,historicalModulSnapshot:historical,setHistoricalModulSnapshot:()=>{},prepareModulAjarExportContext,validateDocumentRequirements:()=>({isValid:true}),
  getLastModulAjarExportDiagnostic,setExportDiagnostic:()=>{},setGeneratingDocType:()=>{},
  setExportErrorMessage:(value:any)=>{error=value;},setExportSuccessMessage:()=>{},
  generateDocument:(_type:any,ctx:any)=>generateModulAjar({...ctx,skipDownload:true}),
  localDocs:[record],setLocalDocs:(records:any[])=>{saves++;record=records[0];},onUpdateDocuments:undefined,
  formatOfficialSnapshotDate:(value:any)=>value,setTimeout:()=>0,
});
await handlerExports.handleGenerateSingleDoc('MODUL_AJAR','docx',false,'snapshot');
assert.equal(error,null);assert.equal(saves,0);assert.equal(record.snapshot,historical);
await handlerExports.handleGenerateSingleDoc('MODUL_AJAR','docx');
assert.equal(error,null);assert.equal(saves,1);assert.equal(record.snapshot.learningPlanId,'lp');
assert.notEqual(record.snapshot,historical);
await handlerExports.handleGenerateSingleDoc('MODUL_AJAR','docx',false,'snapshot');
assert.equal(saves,1);
assert.equal(getLastModulAjarExportDiagnostic()!.snapshotLearningPlanId,'lp-old');
assert(ui.includes('Unduh Snapshot Lama (DOCX)') && ui.includes('Unduh Snapshot Lama (PDF)'));

let reloads=0,updates=0,busy=false;let state:any;
const monitor=createRuntimeUpdateMonitor({runtimeBuildId:identity.buildId,notify:next=>state=next,reload:()=>reloads++,isBusy:()=>busy});
monitor.compare({buildId:'other',buildSha:identity.buildSha});
assert.equal(state.newerBuildId,'other');assert.equal(reloads,0);
monitor.waiting();assert.equal(reloads,0);
busy=true;await monitor.apply(async()=>{updates++;},true);assert.equal(updates,0);assert.equal(reloads,0);
busy=false;await monitor.apply(async()=>{updates++;monitor.controllerChanged();},true);
assert.equal(updates,1);assert.equal(reloads,1);
monitor.controllerChanged();assert.equal(reloads,1); // Duplicate Workbox/native events reload only once.
const external=createRuntimeUpdateMonitor({runtimeBuildId:identity.buildId,notify:next=>state=next,reload:()=>reloads++,isBusy:()=>false});
external.controllerChanged();assert.equal(reloads,1);assert(state.needsReload);
await external.apply(async()=>{},true);assert.equal(reloads,2);
const refreshed=createRuntimeUpdateMonitor({runtimeBuildId:identity.buildId,notify:next=>state=next,reload:()=>reloads++,isBusy:()=>false});
refreshed.compare({buildId:'deployed-newer',buildSha:identity.buildSha});
await refreshed.apply(async()=>{},true,false);assert.equal(reloads,2);
await refreshed.apply(async()=>{},true,true);assert.equal(reloads,3);
const unknown=createRuntimeUpdateMonitor({runtimeBuildId:identity.buildId,notify:()=>{throw new Error('Invalid metadata should be ignored');},reload:()=>{},isBusy:()=>false});
unknown.compare({buildId:' ',buildSha:null});
unknown.compare({buildSha:identity.buildSha});
console.log(JSON.stringify({buildSha:identity.buildSha,modulAjarRendererVersion:MODUL_AJAR_RENDERER_VERSION,selectedLearningPlanId:receipt.selectedLearningPlanId,snapshotLearningPlanId:receipt.snapshotLearningPlanId,meetingCount:receipt.meetingCount,meetingsWithActivities:receipt.meetingsWithActivities,totalMeetingActivities:receipt.totalMeetingActivities},null,2));
console.log('PASS: build SHA injection, fresh live vs explicit historical DOCX, actual download action, activity diagnostics, PWA old-build detection and consent/busy-safe reload.');
