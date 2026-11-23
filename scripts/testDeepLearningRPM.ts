import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createReadyAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { buildImportedProjectExportContext } from '../src/services/identityOnlyProjectExport';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { DOCUMENT_CATALOG, generateDocument, generatePdfDocument } from '../src/services/documentEngine';
import { validateAILearningPlanPayload, normalizeDeepLearningContext, normalizeLearningExperiencePhase, validateGraduateProfileDimensions, createAIDraftLearningPlan, normalizeAIAssessmentPlan, normalizeAIReflection, normalizeAIResources } from '../src/services/learningPlanService';
import { validateLearningPlanActivityMeetings, resolveLearningPlanMeetingBudgets } from '../src/services/learningPlanActivityMeetingService';
import { generateZipBundle } from '../src/services/documentEngine/zipBundle';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { evaluateExpression, initializer } from './helpers/uiContractHarness';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {Type} from '@google/genai';

const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
for(const [level,grade,phase,minutes] of [['SD','Kelas 2','A',35],['SMP','Kelas 7','D',40],['SMA','Kelas 10','E',45]] as const) {
  const state=createReadyAdministrationImportFixture();
  Object.assign(state.yearPlans[0],{level,grade,phase});
  const plan=state.semesterData.learningPlan[0].value[0];
  plan.initialCompetency='PRASYARAT_UNIK';plan.targetStudents='Asumsi perencanaan KESIAPAN_UNIK, diperiksa melalui asesmen awal.';
  plan.learningModel='PRAKTIK_UNIK';plan.meaningfulUnderstanding='MAKNA_UNIK';plan.triggerQuestions=['PEMANTIK_UNIK'];
  plan.differentiation={content:'KONTEN_UNIK',process:'PROSES_UNIK',product:'PRODUK_UNIK'};
  plan.reflection={teacherReflection:'GURU_REFLEKSI_UNIK',studentReflection:'MURID_REFLEKSI_UNIK'};
  plan.learningSteps!.core![0].durationMinutes=2*minutes-20;
  plan.deepLearningContext={principles:['MINDFUL','MEANINGFUL','JOYFUL'],framework:{pedagogicalPractice:['PEDAGOGIS_UNIK'],learningPartnership:['MITRA_UNIK'],learningEnvironment:['LINGKUNGAN_UNIK'],digitalUtilization:['DIGITAL_UNIK']}};
  for(const [group,items] of Object.entries(plan.assessmentPlan)) for(const item of items || []) {
    item.description=group+'_ASESMEN_UNIK';item.method=group+'_METODE_UNIK';item.technique=group+'_TEKNIK_UNIK';item.instrument=group+'_INSTRUMEN_UNIK';
  }
  for(const criterion of state.semesterData.assessmentCriteria[0].value) {
    criterion.notes='KKTP_CATATAN_UNIK';criterion.passingThreshold=75;
    criterion.levels=[{level:'Baik',label:'KKTP_LABEL_UNIK',description:'KKTP_LEVEL_UNIK'}];
  }
  const context={...buildImportedProjectExportContext(state,'y'),skipDownload:true};
  const before=JSON.stringify(state),projection=buildModulAjarProjection(context);
  assert(projection.isReady,projection.error);assert.equal(projection.meetings![0].durationMinutes,2*minutes);
  const word=await generateDocument('MODUL_AJAR',context);assert(word.blob);
  const archive=await JSZip.loadAsync(new Uint8Array(await word.blob.arrayBuffer())),xml=await archive.file('word/document.xml')!.async('string');
  const pdf=await generatePdfDocument('MODUL_AJAR',context),loader=getDocument({data:new Uint8Array(await pdf.blob.arrayBuffer()),useSystemFonts:true}),doc=await loader.promise;
  let text='';
  for(let page=1;page<=doc.numPages;page++) {
    const p=await doc.getPage(page),viewport=p.getViewport({scale:1}),content=await p.getTextContent();
    for(const item of content.items as any[]) if(item.str?.trim()) {
      text+=item.str+' ';
      assert(item.transform[4]>=25 && item.transform[4]+item.width<=viewport.width-20,`${level}: text outside horizontal page margin`);
      assert(item.transform[5]>=20 && item.transform[5]<=viewport.height-20,`${level}: text outside vertical page margin`);
    }
  }
  for(const token of ['PRASYARAT_UNIK','KESIAPAN_UNIK','PRAKTIK_UNIK','MAKNA_UNIK','PEMANTIK_UNIK','KONTEN_UNIK','PROSES_UNIK','PRODUK_UNIK',
    'GURU_REFLEKSI_UNIK','MURID_REFLEKSI_UNIK','PEDAGOGIS_UNIK','MITRA_UNIK','LINGKUNGAN_UNIK','DIGITAL_UNIK','KKTP_CATATAN_UNIK','KKTP_LABEL_UNIK','KKTP_LEVEL_UNIK',
    ...(plan.learningExperiences || []).map(exp=>exp.description),
    ...Object.keys(plan.assessmentPlan).flatMap(group=>[group+'_ASESMEN_UNIK',group+'_METODE_UNIK',group+'_TEKNIK_UNIK',group+'_INSTRUMEN_UNIK'])]) {
    assert(xml.includes(token),`${level} DOCX missing ${token}`);assert(text.includes(token),`${level} PDF missing ${token}`);
  }
  assert(xml.includes('w:cantSplit'));assert(xml.includes('w:keepNext'));
  assert.equal(JSON.stringify(state),before,'Rendering cannot rewrite LearningPlan/canonical data');
  await loader.destroy();console.log(`PASS P0 ${level}: shared TP/ATP/material/JP/activities/assessment/KKTP/context; actual DOCX/PDF; PDF margins, DOCX signoff guards`);
}

const source=createReadyAdministrationImportFixture(),context=buildImportedProjectExportContext(source,'y'),raw:any=structuredClone(context.learningPlans![0]);
const tpIds=raw.tpIds,meetings=[{meetingId:'meet',jp:2,linkedTpIds:tpIds}];
raw.targetStudents='Asumsi perencanaan: kebutuhan murid diperiksa melalui observasi awal.';
raw.materialCharacteristics='Gerak manipulatif memerlukan koordinasi dan jarak aman saat melempar.';
raw.deepLearningContext={principles:['MEANINGFUL'],framework:{pedagogicalPractice:['Praktik terbimbing dan umpan balik pasangan'],learningPartnership:[],learningEnvironment:['Area datar dengan jarak aman antarmurid'],digitalUtilization:[]}};
raw.learningExperiences=['UNDERSTAND','APPLY','REFLECT'].map(phase=>({id:'experience-'+phase,phase,description:'Murid membandingkan hasil gerak dan menjelaskan cara memperbaiki koordinasi '+phase,learningMeetingId:'meet',linkedTpIds:tpIds}));
for(const group of ['initial','formative','summative'])raw.assessmentPlan[group]=[{type:group.toUpperCase(),description:'Observasi koordinasi lemparan dan alasan memilih arah gerak pada sasaran aman.',technique:'Observasi',instrument:'Ceklis gerak',linkedTpIds:tpIds,learningMeetingId:'meet'}];
const options={tpIds,meetings};assert(validateAILearningPlanPayload(structuredClone(raw),options).isValid);
assert.deepEqual(normalizeDeepLearningContext(raw.deepLearningContext)?.framework,raw.deepLearningContext.framework,'Existing framework must survive normalization, including explicit optional empty lists');
function serverFunction(name:string,bindings:Record<string,unknown>={}) {
  const ast=ts.createSourceFile('server.ts',readFileSync('server.ts','utf8'),ts.ScriptTarget.Latest,true);
  const fn=ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert(fn,name);
  return evaluateExpression(fn.getText(ast).replace(/^export\s+/,''),bindings);
}
const backend=serverFunction('validateAILearningPlanPayload',{
  validateLearningPlanDesignPayload:validateAILearningPlanPayload,normalizeExperiencePhase:normalizeLearningExperiencePhase,
  validateGraduateProfileDimensions,validateLearningPlanActivityMeetings,isPedagogicalItemValid:serverFunction('isPedagogicalItemValid'),
});
assert(backend(structuredClone(raw),meetings,context.academicSetting,tpIds).isValid);
for(const mutate of [
  (p:any)=>delete p.deepLearningContext.framework,
  (p:any)=>p.learningExperiences.pop(),
  (p:any)=>p.learningExperiences[0].linkedTpIds=['invented'],
  (p:any)=>p.assessmentPlan.formative[0].learningMeetingId='wrong-meeting',
  (p:any)=>p.assessmentPlan.summative[0].linkedTpIds=[tpIds[0]],
  (p:any)=>p.deepLearningContext.principles=['INVALID'],
  (p:any)=>p.learningExperiences[0].description='Memahami',
  (p:any)=>p.assessmentPlan.initial[0].description='Observasi',
]) {
  const invalid=structuredClone(raw);mutate(invalid);
  const result=validateAILearningPlanPayload(invalid,options);assert.equal(result.isValid,false);assert(result.reason);
  assert.equal(backend(structuredClone(invalid),meetings,context.academicSetting,tpIds).isValid,false);
}
const schema=evaluateExpression(initializer('server.ts','learningPlanResponseSchema'),{Type});
assert(schema.required.includes('deepLearningContext'));assert(schema.properties.deepLearningContext.properties.framework.required.includes('digitalUtilization'));
const draft=createAIDraftLearningPlan({academicSetting:context.academicSetting,tpIds,atpItemIds:raw.atpItemIds,unitId:raw.unitId,learningMeetingIds:['meet'],meetings,allocatedJP:2,aiDraft:{...raw,allocatedJP:999},context:{tp:context.tp,atp:context.atp}});
assert.equal(draft.status,'DRAFT');assert.equal(draft.allocatedJP,2);assert.deepEqual(draft.learningMeetingIds,['meet']);
assert.equal(draft.materialCharacteristics,raw.materialCharacteristics);assert.deepEqual(draft.deepLearningContext?.framework,raw.deepLearningContext.framework);
assert.deepEqual(draft.assessmentPlan.formative![0].linkedTpIds,tpIds);
const wrongBudget=structuredClone(raw);wrongBudget.learningSteps.core[0].durationMinutes+=1;
assert.equal(backend(wrongBudget,meetings,context.academicSetting,tpIds).isValid,false);
const legacy=buildImportedProjectExportContext(createReadyAdministrationImportFixture(),'y');
assert(buildModulAjarProjection(legacy).isReady,'Historical plan remains exportable without new design fields');
assert((await generateDocument('MODUL_AJAR',legacy)).blob);
assert((await generatePdfDocument('MODUL_AJAR',legacy)).blob);
console.log('PASS P1: shared frontend/backend new-AI design guards, 8 invalid responses rejected, canonical budgets/IDs, optional digital/partnership, draft-only apply and historical export');

const serviceAst=ts.createSourceFile('aiService.ts',readFileSync('src/services/aiService.ts','utf8'),ts.ScriptTarget.Latest,true);
const generateNode=serviceAst.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='generateLearningPlanWithAI');assert(generateNode);
let provider=structuredClone(raw),requests=0;
const generateAI=evaluateExpression(generateNode.getText(serviceAst).replace(/^export\s+/,''),{
  resolveLearningPlanMeetingBudgets,getCognitiveAdaptationProfile:()=>undefined,
  aiFetch:async()=>{requests++;return {ok:true,json:async()=>({data:structuredClone(provider)})};},
  validateLearningPlanActivityMeetings,validateAILearningPlanPayload,normalizeLearningExperiencePhase,normalizeAIAssessmentPlan,normalizeAIReflection,normalizeDeepLearningContext,normalizeAIResources,
  formatAIErrorMessage:(error:Error)=>error.message,
});
const aiParams={academicSetting:context.academicSetting,tps:context.tp!.items,meetings,allocatedJP:2};
const generated=await generateAI(aiParams);assert.deepEqual(generated.deepLearningContext.framework,raw.deepLearningContext.framework);assert.equal(generated.allocatedJP,2);
provider={...raw,deepLearningContext:undefined};await assert.rejects(()=>generateAI(aiParams),/framework/);assert.equal(requests,2,'Frontend does not introduce an extra retry/provider call');
console.log('PASS actual AI client with mocked transport: valid design retained, invalid design rejected, no new retry; Gemini live NOT VERIFIED');

const designedContext={...context,
  profile:{...context.profile,name:'Guru Perencanaan Pembelajaran Mendalam dengan Nama Panjang dan Gelar Akademik M.Pd.'},
  school:{...context.school,principalName:'Kepala Sekolah Penggerak dengan Nama Sangat Panjang beserta Gelar Akademik M.Pd.'},
  learningPlans:[raw],activeLearningPlanId:raw.id,skipDownload:true};
const moduleView=buildModulAjarProjection(designedContext),rpmContext={...designedContext,learningPlanPresentation:'RPM' as const},rpmView=buildModulAjarProjection(rpmContext);
assert(rpmView.isReady,rpmView.error);assert.deepEqual(rpmView.plan,moduleView.plan);assert.deepEqual(rpmView.meetings,moduleView.meetings);
assert.deepEqual(rpmView.resolvedTPs,moduleView.resolvedTPs);assert.equal(rpmView.resolvedAllocatedJP,moduleView.resolvedAllocatedJP);
const headings=['I. IDENTIFIKASI','II. DESAIN PEMBELAJARAN','III. PENGALAMAN BELAJAR','IV. ASESMEN'];assert.deepEqual(rpmView.sections!.map(s=>s.title),headings);
const beforePresentation=JSON.stringify(designedContext);
assert.deepEqual(DOCUMENT_CATALOG.filter(item => ['MODUL_AJAR', 'RPM'].includes(item.type)).map(item => item.type), ['MODUL_AJAR', 'RPM']);
assert(!readFileSync('src/components/AdminDocsExport.tsx','utf8').includes('Penyajian perencanaan'));
const rpmWord=await generateDocument('RPM',designedContext);assert(rpmWord.fileName.startsWith('RPM_'));assert.equal(rpmWord.record?.type,'RPM');assert.equal(rpmWord.record?.snapshot?.learningPlanId,raw.id);
const rpmZip=await JSZip.loadAsync(new Uint8Array(await rpmWord.blob!.arrayBuffer())),rpmXml=await rpmZip.file('word/document.xml')!.async('string');
const rpmPdf=await generatePdfDocument('RPM',designedContext);assert(rpmPdf.fileName.startsWith('RPM_'));
const rpmLoader=getDocument({data:new Uint8Array(await rpmPdf.blob.arrayBuffer()),useSystemFonts:true}),rpmDoc=await rpmLoader.promise;let rpmText='',lastPageText='';
for(let page=1;page<=rpmDoc.numPages;page++) {
  const p=await rpmDoc.getPage(page),viewport=p.getViewport({scale:1}),items=(await p.getTextContent()).items as any[];
  lastPageText=items.map(item=>item.str || '').join(' ');rpmText+=lastPageText;
  for(const item of items)if(item.str?.trim()){assert(item.transform[4]>=25 && item.transform[4]+item.width<=viewport.width-20);assert(item.transform[5]>=20 && item.transform[5]<=viewport.height-20);}
}
for(const signatory of [designedContext.school.principalName,designedContext.school.principalNip,designedContext.profile.name,designedContext.profile.nip])if(signatory)assert(lastPageText.includes(signatory),'RPM signature identities must stay together on the final page');
for(const token of [...headings,raw.materialCharacteristics,raw.targetStudents,...raw.learningExperiences.map((e:any)=>e.description)]) {assert(rpmXml.includes(token),token);assert(rpmText.includes(token),token);}
assert(rpmXml.includes('w:cantSplit'));assert(rpmXml.includes('w:keepNext'));await rpmLoader.destroy();
assert.equal(JSON.stringify(designedContext),beforePresentation,'Switching presentation cannot change plan or source substance');

const duplicate=structuredClone(designedContext),core=duplicate.learningPlans[0].learningSteps!.core![0];core.description='PRAKTIK_DUPLIKAT_SAMA';
Object.assign(duplicate.learningPlans[0].learningExperiences![0],{description:core.description,learningMeetingId:'meet'});
const dedup=buildModulAjarProjection(duplicate);assert(dedup.isReady,dedup.error);
assert.equal(dedup.meetings![0].activityLines.filter(line=>line.includes(core.description)).length,1);assert(dedup.meetings![0].activityLines.some(line=>line.includes('Memahami')));
const dedupWord=await generateDocument('MODUL_AJAR',duplicate),dedupZip=await JSZip.loadAsync(new Uint8Array(await dedupWord.blob!.arrayBuffer()));
assert.equal(((await dedupZip.file('word/document.xml')!.async('string')).match(/PRAKTIK_DUPLIKAT_SAMA/g) || []).length,1);
console.log('PASS P2: RPM four sections, same LearningPlan/lineage/JP/dates, actual DOCX/PDF, no source mutation and exact duplicate activity displayed once');

const transferable=structuredClone(source);transferable.semesterData.learningPlan[0].value=[raw];
const original=JSON.stringify(transferable),project=await readCompleteProjectZip(await createCompleteProjectZip(transferable,'y'));
const target=prepareCompleteAdministrationProjectImport(transferable,project,{mode:'IDENTITY_ONLY',targetProfileId:'p2',targetSchoolId:'s2',documentDate:'2026-11-16',workMode:'production'});
const importedContext={...buildImportedProjectExportContext(target.state,target.yearPlanId),workMode:'production' as const,skipDownload:true};
const bundle=await generateZipBundle({types:['MODUL_AJAR','RPM'],format:'both'},importedContext);assert(bundle.zipBlob);assert(!bundle.itemResults?.some(item=>item.status==='FAILED'));
const files=await JSZip.loadAsync(new Uint8Array(await bundle.zipBlob.arrayBuffer())),names=Object.keys(files.files).filter(name=>/\.(docx|pdf)$/.test(name));
assert.equal(names.length,4);
assert.equal(new Set(names).size,4);
assert(names.some(name=>name.endsWith('/WORD/Semester_1/RPM_Bab_1.docx')));
assert(names.some(name=>name.endsWith('/PDF/Semester_1/Modul_Ajar_Bab_1.pdf')));
for (const format of ['pdf', 'docx'] as const) {
  const single = await generateZipBundle({ types: ['RPM'], format }, importedContext);
  const files = Object.keys((await JSZip.loadAsync(await single.zipBlob!.arrayBuffer())).files);
  assert(files.some(name => name.endsWith('.'+format)));
  assert(files.every(name => !name.includes(format === 'pdf' ? '/WORD/' : '/PDF/')));
}
const importedXml=await(await JSZip.loadAsync(await files.file(names.find(name=>name.endsWith('/RPM_Bab_1.docx'))!)!.async('uint8array'))).file('word/document.xml')!.async('string');
assert(importedXml.includes('GURU_TUJUAN_TEST'));assert(!importedXml.includes('GURU_ASAL_TEST'));assert(importedXml.includes(raw.materialCharacteristics));
assert.equal(JSON.stringify(transferable),original,'Import/export cannot change the source project');
console.log('PASS Production RPM ZIP actual four files, import to another teacher/school, shared design/substance, no AI; Normal exports remain available');
