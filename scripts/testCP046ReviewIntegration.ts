import { createInitialStorageV5 } from '../src/services/storageV5';
import { exportCompleteAdministrationProjectFromState } from '../src/services/administrationProjectExportService';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ALL_MASTER_CP_ENTRIES, resolveCPContext } from '../src/data/curriculum/cp';
import { SMP_REVIEW_CP_ENTRIES } from '../src/data/curriculum/cp/smp';
import { SMA_REVIEW_CP_ENTRIES } from '../src/data/curriculum/cp/sma';
import { CP046_SUBJECT_CODES, separateElementLabel } from '../src/data/curriculum/cp/review046Adapter';
import { CP046_SUBJECTS, findCP046Subject, isReligionSubject, normalizeSubjectString } from '../src/data/curriculum/subjects';
import { SUBJECT_OPTIONS } from '../src/data/curriculumDefaults';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { validateCPDataWorkflow } from '../src/services/cpWorkflowService';
const entries = [...SMP_REVIEW_CP_ENTRIES, ...SMA_REVIEW_CP_ENTRIES];
assert.equal(entries.length, 84);
assert.equal(entries.reduce((n,r)=>n+r.elements.length,0),327);
assert.equal(entries.flatMap(r=>r.elements).reduce((n,e)=>n+(e.subelements?.length||0),0),30);
assert.equal(new Set(Object.values(CP046_SUBJECT_CODES)).size,Object.keys(CP046_SUBJECT_CODES).length);
assert.equal(new Set(ALL_MASTER_CP_ENTRIES.map(e=>e.id)).size,ALL_MASTER_CP_ENTRIES.length);
const identities = new Map<string,string>();
for(const s of CP046_SUBJECTS) for(const name of [s.name,...s.aliases||[]]) {
 const key=normalizeSubjectString(name); assert(!identities.has(key)||identities.get(key)===s.code, name); identities.set(key,s.code);
}
for(const entry of entries) {
 assert.equal(entry.verificationStatus,'UNVERIFIED');
 assert.equal(findCP046Subject(entry.sourceReview!.subjectName)?.code,entry.subjectCode);
 assert(SUBJECT_OPTIONS[entry.level].some(name=>findCP046Subject(name)?.code===entry.subjectCode));
 for(const academicYear of ['2024/2025','2025/2026','2026/2027']) {
  const context={subject:entry.subjectCode, phase:entry.phase,level:entry.level,academicYear};
  const before=JSON.stringify(context);const report=cpSourceRepository.searchWithDiagnostics(context, { sourceSet: 'review046' });
  assert.notEqual(report.status,'AMBIGUOUS',report.reason);assert.equal(JSON.stringify(context),before);
  if(academicYear==='2024/2025')assert(!report.results.some(r=>r.id===entry.id));
  else if(academicYear==='2026/2027'&&isReligionSubject(entry.subjectCode))assert(!report.results.some(r=>r.sourceMeta.regulationId==='DEC-BSKAP-046-2025'));
  else {
   assert.equal(report.status,'RESOLVED',report.reason);const result=report.results[0];assert.equal(result.id,entry.id);
   assert.equal(result.verificationStatus,'UNVERIFIED');assert(result.isSelectable);
   assert.deepEqual(result.sourceMeta.sourceReview,entry.sourceReview);
   assert.equal(result.elements.length,entry.elements.length);
   for(let i=0;i<result.elements.length;i++) {const e=result.elements[i],source=entry.elements[i];assert.equal(e.id,source.id);assert.match(e.code!,/^E\d+$/);assert.equal(e.sourceNumber,source.number);assert.equal(e.content,source.content);assert(e.content.trim());assert.equal(e.subelements?.length,source.subelements?.length);}
   const saved=JSON.parse(JSON.stringify({id:'cp',academicSettingId:'year',generalDescription:result.generalDescription,elements:result.elements,source:result.sourceMeta,updatedAt:'2026-10-29'}));
   assert.equal(validateCPDataWorkflow(saved).issues.length,0);
   assert.deepEqual(saved.elements,result.elements);
  }
 }
 const wrong=resolveCPContext({sourceSet:'review046',subjectCode:entry.subjectCode,phase:entry.phase,level:entry.level==='SMP'?'SMA':'SMP',academicYear:'2025/2026'});assert.equal(wrong.status,'UNRESOLVED');
}
const entry=entries[0];const duplicate={...entry,id:'conflicting-unrelated-version'};
assert.equal(resolveCPContext({sourceSet:'review046',subjectCode:entry.subjectCode,phase:entry.phase,level:entry.level,academicYear:'2025/2026',entriesPool:[entry,duplicate]}).status,'AMBIGUOUS');
assert.equal(findCP046Subject('Bahasa'), undefined);
assert.equal(separateElementLabel('Seni','Seniman berkarya'),'Seniman berkarya');
for(const [level,version] of [['smp','v5'],['sma','v6']]) {
 const file=`cp-${level}-bskap-046-2025-${version}-review.json`;
 const source=readFileSync(`src/data/curriculum/cp/sources/${file}`);
 const expectedHashes: Record<string,string> = {"cp-smp-bskap-046-2025-v5-review.json":"2751ea7833116d6cd88776c3e9257107f2c8cbda9c4f4c4335324e638fcf9bdc","cp-sma-bskap-046-2025-v6-review.json":"8a183545bbfcf270717b6c18afb274ab7f1b5b189aa2fd49caee7874761b8cf2"};
 assert.equal(createHash('sha256').update(source).digest('hex'),expectedHashes[file]);
 const raw=JSON.parse(source.toString());
 if(level==='sma') assert.equal(raw.records.flatMap((r:any)=>r.elemen).filter((e:any)=>e.teks.startsWith(e.nama+' ')).length,169);
 for(const r of raw.records) {
  const adapted=entries.find(e=>e.id===r.id)!;
  for(let i=0;i<r.elemen.length;i++) {assert.equal(adapted.elements[i].sourceText,r.elemen[i].teks);assert.equal(adapted.elements[i].name,r.elemen[i].nama);if (!r.elemen[i].subelemen.length) assert.equal(adapted.elements[i].content,separateElementLabel(r.elemen[i].nama,r.elemen[i].teks));}
 }
}
console.log('PASS: 84 records, 327 elements, 30 subelements; exact source hashes; identities, selection, resolver/year/level, REVIEW and JSON persistence.');


// Exercise the actual project ZIP backup/restore with an imported hierarchical CP.
const state = createInitialStorageV5();
const now='2026-10-29T00:00:00Z';
state.schools=[{id:'s',name:'School',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:now,updatedAt:now}];
state.profiles=[{id:'p',name:'Teacher',nip:'',status:'PNS',defaultSubject:'PAK',defaultLevel:'SMP',schoolId:'s',createdAt:now,updatedAt:now}];
state.yearPlans=[{id:'y',profileId:'p',schoolId:'s',academicYear:'2025/2026',curriculumType:'KURIKULUM_MERDEKA',subject:'PAK',grade:'Kelas 7',phase:'D',level:'SMP',createdAt:now,updatedAt:now}];
state.workspaces=[{id:'w',yearPlanId:'y',profileId:'p',schoolId:'s',name:'CP review',createdAt:now,updatedAt:now}];
state.semesterPlans=[1,2].map(semester=>({id:'sp'+semester,yearPlanId:'y',semester:semester as 1|2,createdAt:now,updatedAt:now}));
const selected=cpSourceRepository.searchWithDiagnostics({subject:'PAK',level:'SMP',phase:'D',academicYear:'2025/2026'}, {sourceSet:'review046'}).results[0];
state.annualData.cp=[{yearPlanId:'y',value:{id:'cp',academicSettingId:'y',generalDescription:selected.generalDescription,elements:selected.elements,source:selected.sourceMeta,workflowStatus:'SIAP',updatedAt:now}}];
const originalState=JSON.stringify(state);
const archive=exportCompleteAdministrationProjectFromState(state,'y');
const zip=await createCompleteProjectZip(state, 'y');
const restoredArchive=await readCompleteProjectZip(zip);
const restored=prepareCompleteAdministrationProjectImport(state,restoredArchive,{mode:'RESTORE',targetProfileId:'p',targetSchoolId:'s',replaceYearPlanId:'y'});
assert.deepEqual(restored.state.annualData.cp[0].value,state.annualData.cp[0].value);
assert.deepEqual(restored.state.profiles,state.profiles);
assert.equal(JSON.stringify(state),originalState);
console.log('PASS: imported parent/subelement IDs, raw text, metadata and teacher profile survive actual ZIP RESTORE without source mutation.');
