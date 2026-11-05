import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { CPSourceFigures } from '../src/components/CPSourceFigures';
import { ALL_MASTER_CP_ENTRIES, REVIEW_CP046_ENTRIES, resolveCPContext } from '../src/data/curriculum/cp';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { getRegulationSource } from '../src/data/curriculum/regulations';
import { RELIGION_SUBJECT_CODES } from '../src/data/curriculum/subjects';
import { getSubjectChoices } from '../src/services/subjectSelection';
import { createTwoSemesterAdministrationImportFixture } from './fixtures/readyAdministrationImportFixture';
import { saveStorageV5, loadStorageV5 } from '../src/services/storageV5';
import visual from '../src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-visual-supplement.json';
import protectedBaseline from './fixtures/cpGap409a48fBaseline.json';

// Static normalized hashes also work in CI's shallow checkout.
for(const [file,expected] of Object.entries(protectedBaseline.files)) {
  assert.equal(createHash('sha256').update(readFileSync(file,'utf8').replace(/\r\n/g,'\n')).digest('hex'),expected,file+' must not change');
}
assert.equal(REVIEW_CP046_ENTRIES.filter(e=>e.level==='SD').length,37);
assert.equal(createHash('sha256').update(JSON.stringify(REVIEW_CP046_ENTRIES.filter(e=>e.level==='SD'&&e.id!=='cp046-2025-sd-a-mat'))).digest('hex'),protectedBaseline.sd36EntriesHash,'All 36 previously integrated runtime records remain identical');
const record=visual.records[0],figure=record.sourceFigures[0];
const bytes=readFileSync('public'+figure.assetPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'),figure.sha256);
assert.equal(bytes.readUInt32BE(16),229);assert.equal(bytes.readUInt32BE(20),78);
assert.equal(figure.transcription,'(●●● | ●●●●) = (●● | ●●●●●) = (● | ●●●●●●)');
assert.equal(figure.pdfPage,112);assert.equal(figure.elementNumber,'1.2');
for(const academicYear of ['2024/2025','2025/2026','2026/2027']) {
  const r=resolveCPContext({sourceSet:'review046',subjectCode:'MAT',phase:'A',level:'SD',academicYear});
  assert.equal(r.status,academicYear==='2024/2025'?'UNRESOLVED':'RESOLVED');
  if(r.cp){assert.equal(r.cp.verificationStatus,'VERIFIED');assert.equal(r.cp.elements.length,5);assert(r.cp.elements[1].content.includes(figure.transcription));assert(r.cp.elements[1].sourceText?.includes('Contoh:'));}
  assert.equal(resolveCPContext({subjectCode:'CODING_AI',phase:'B',level:'SD',academicYear}).status,'UNRESOLVED');
}
assert(ALL_MASTER_CP_ENTRIES.some(e=>e.id==='cp-sd-fase-b-coding-ai'),'Historical source retained');
assert.match(cpSourceRepository.searchWithDiagnostics({subject:'CODING_AI',phase:'B',level:'SD',academicYear:'2025/2026'}).reason,/Fase C/);
assert(getSubjectChoices({level:'SD',phase:'B',academicYear:'2025/2026'}).some(s=>s.code==='CODING_AI'),'Manual subject remains available');
assert.equal(resolveCPContext({sourceSet:'review046',subjectCode:'CODING_AI',phase:'C',level:'SD',academicYear:'2026/2027'}).status,'RESOLVED');
assert.equal(resolveCPContext({sourceSet:'review046',subjectCode:'BING',phase:'C',level:'SD',academicYear:'2025/2026'}).status,'UNRESOLVED');
const quarantine=JSON.parse(readFileSync('docs/cp046-sd-v21-quarantine.json','utf8'));
const english=quarantine.records.find((r:any)=>r.id==='cp046-2025-sd-c-bing');
assert(english.teks_sumber_ekstraksi.includes('Listening - Writing'));
assert.match(english.teks_sumber_ekstraksi,/Kelas\s+III\s+dan\s+IV/);
for(const code of RELIGION_SUBJECT_CODES)for(const phase of ['A','B','C'] as const) {
  const current=resolveCPContext({subjectCode:code,phase,level:'SD',academicYear:'2026/2027'});
  const review=resolveCPContext({subjectCode:code,phase,level:'SD',academicYear:'2026/2027',sourceSet:'review046'});
  assert.equal(review.status,'UNRESOLVED','046 cannot replace religion 020');
  if(phase==='A'){assert.equal(current.status,'RESOLVED');assert.equal(current.cp!.regulationSourceId,'DEC-BKPDM-020-2026');assert.equal(current.cp!.verificationStatus,'UNVERIFIED');}
  else assert.equal(current.status,'UNRESOLVED');
}
const reg=getRegulationSource('DEC-BKPDM-020-2026')!;
assert.match(reg.authority,/Badan Kebijakan Pendidikan Dasar dan Menengah/);
assert.equal(reg.legalEffectiveDate,'2026-06-11');assert.match(reg.sourceUrl,/id=142/);

const result=cpSourceRepository.searchWithDiagnostics({subject:'MAT',phase:'A',level:'SD',academicYear:'2025/2026'},{sourceSet:'review046'}).results[0];
const markup=renderToStaticMarkup(<CPSourceFigures source={result.sourceMeta}/>);
assert(markup.includes(figure.assetPath));assert(markup.includes('Transkripsi visual'));assert(markup.includes('112'));
const forged=structuredClone(result.sourceMeta);forged.sourceReview!.figures![0].assetPath='https://invalid.example/leak';
assert(!renderToStaticMarkup(<CPSourceFigures source={forged}/>).includes('<img'));
// Execute the actual Step 03 apply callback: image metadata must stage into the
// draft, never auto-save or replace persisted teacher CP on source browsing.
const ast=ts.createSourceFile('CPManager.tsx',readFileSync('src/components/CPManager.tsx','utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let expr='';function walk(n:ts.Node){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='handleApplySelectedSource')expr=n.initializer!.getText(ast);ts.forEachChild(n,walk);}walk(ast);assert(expr);
const draft:any={};const bindings:any={sourceSearch:{status:'RESOLVED'},generalDescription:'',onSaveCP:()=>assert.fail('Source selection may only stage a draft')};
for(const key of ['GeneralDescription','Elements','Source','IsSourceModalOpen','PendingReviewedSource'])bindings['set'+key]=(v:unknown)=>draft[key]=v;
const js=ts.transpileModule(`return (${expr});`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
new Function(...Object.keys(bindings),js)(...Object.values(bindings))(result);
assert(draft.PendingReviewedSource);assert.deepEqual(draft.Source.sourceReview.figures,[figure]);
const state=createTwoSemesterAdministrationImportFixture();
state.annualData.cp[0].value={...state.annualData.cp[0].value,elements:draft.Elements,source:draft.Source};
state.annualData.cp[0].value.elements[0].content='TEKS GURU - PERTAHANKAN';
const before=JSON.stringify(state.annualData.cp);const store=new Map<string,string>();
Object.assign(globalThis,{localStorage:{getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>store.set(k,v)}});
saveStorageV5(state);const loaded=loadStorageV5();assert.equal(JSON.stringify(loaded.annualData.cp),before);
assert(renderToStaticMarkup(<CPSourceFigures source={loaded.annualData.cp[0].value.source}/>).includes(figure.assetPath));
assert.deepEqual(loaded.annualData.tp,state.annualData.tp);assert.deepEqual(loaded.annualData.atp,state.annualData.atp);
console.log('PASS MAT A text + original figure + transcription; explicit Step 03 draft; V5 reload/teacher data; Coding B exclusion; English C quarantine; 18 religion contexts with no 046 fallback; protected baseline files unchanged.');
