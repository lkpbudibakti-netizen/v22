import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ALL_MASTER_CP_ENTRIES, REVIEW_CP046_ENTRIES, resolveCPContext } from '../src/data/curriculum/cp';
import { SD_REVIEW_CP_ENTRIES } from '../src/data/curriculum/cp/sd046';
import { findCP046Subject, isReligionSubject } from '../src/data/curriculum/subjects';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { getSubjectChoices, getSubjectCPAvailability } from '../src/services/subjectSelection';
import { validateCPDataWorkflow, validateCPAnalysisDataWorkflow, validateTPDataWorkflow } from '../src/services/cpWorkflowService';
import { validateCP4Input } from '../src/services/cpAnalysisDraft';
import { separateElementLabel } from '../src/data/curriculum/cp/review046Adapter';
import { createInitialStorageV5, saveStorageV5, loadStorageV5 } from '../src/services/storageV5';
import source from '../src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-source-matched.json';
import supplement from '../src/data/curriculum/cp/sources/cp-sd-bskap-046-2025-visual-supplement.json';
import quarantine from '../docs/cp046-sd-v21-quarantine.json';
import baseline from '../docs/cp046-sd-v21-baseline.json';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(hash(ALL_MASTER_CP_ENTRIES),baseline.historicalHash,'Historical registry unchanged');
assert.equal(hash(REVIEW_CP046_ENTRIES.filter(e=>e.level!=='SD')),baseline.secondaryReviewHash,'SMP/SMA untouched');
const originalEntries=[...ALL_MASTER_CP_ENTRIES,...REVIEW_CP046_ENTRIES.filter(e=>e.level!=='SD')];
const resolutions=originalEntries.filter(e=>e.id!=='cp-sd-fase-b-coding-ai').flatMap(e=>['2024/2025','2025/2026','2026/2027'].map(academicYear=>{
  const q={subjectCode:e.subjectCode,phase:e.phase,level:e.level,academicYear,sourceSet:e.sourceReview?'review046':undefined};
  const r=resolveCPContext(q as any);return {q,status:r.status,id:r.cp?.id};
}));
assert.equal(hash(resolutions),baseline.resolutionsExcludingAuditedCodingBHash,'Every original resolver outcome except the audited invalid Coding B remains identical');
assert.equal(SD_REVIEW_CP_ENTRIES.length,37);
assert.equal(quarantine.records.length,2);
const candidates=[...source.records,...supplement.records,...quarantine.records.filter(r=>!supplement.records.some(s=>s.id===r.id))];
assert.equal(candidates.length,38);
assert.equal(new Set([...ALL_MASTER_CP_ENTRIES,...REVIEW_CP046_ENTRIES].map(e=>e.id)).size,ALL_MASTER_CP_ENTRIES.length+REVIEW_CP046_ENTRIES.length);
const storage=new Map<string,string>();
Object.assign(globalThis,{localStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v),removeItem:(k:string)=>storage.delete(k)}});
const state=createInitialStorageV5(); const stamp='2026-11-01T00:00:00Z';
state.schools=[{id:'s',name:'School',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
state.profiles=[{id:'p',schoolId:'s',name:'Teacher',nip:'',status:'PNS',defaultSubject:'MAT',defaultLevel:'SD',createdAt:stamp,updatedAt:stamp}];
for(const record of candidates) {
  const integrated=SD_REVIEW_CP_ENTRIES.some(r=>r.id===record.id);
  const entry=SD_REVIEW_CP_ENTRIES.find(e=>e.id===record.id);
  assert.equal(Boolean(entry),integrated,record.id);
  assert.equal(findCP046Subject(record.mata_pelajaran)?.code,entry?.subjectCode??record.mata_pelajaran);
  for(const academicYear of ['2024/2025','2025/2026','2026/2027']) {
    const context={level:'SD',phase:record.fase,subject:record.mata_pelajaran,academicYear};
    const report=cpSourceRepository.searchWithDiagnostics(context,{sourceSet:'review046'});
    const expected=integrated&&academicYear!=='2024/2025'&&!(academicYear==='2026/2027'&&isReligionSubject(record.mata_pelajaran));
    assert.equal(report.status,expected?'RESOLVED':'UNRESOLVED',record.id+academicYear);
    assert(getSubjectChoices(context).some(s=>s.code===record.mata_pelajaran),'Manual subject path remains visible');
    if(expected) {
      const result=report.results[0];assert.equal(result.id,record.id);assert.equal(result.verificationStatus,'VERIFIED');
      assert.equal(result.sourceMeta.subjectCode,record.mata_pelajaran);assert.equal(result.sourceMeta.phase,record.fase);
      assert.equal(result.sourceMeta.sourceReview?.pages.awal,record.sumber_halaman_pdf.awal);
      assert.equal(result.elements.length,record.elemen.length);
      for(let i=0;i<record.elemen.length;i++) {
        const e=result.elements[i],raw=record.elemen[i];assert.equal(e.name,raw.nama);assert.equal(e.sourceNumber,raw.nomor);
        assert.equal(e.subelements?.length,raw.subelemen.length);assert(e.content.trim());
        if(!raw.subelemen.length) {
          const figure=entry!.sourceReview?.figures?.find(f=>f.elementNumber===raw.nomor);
          const expected=separateElementLabel(raw.nama,raw.teks);
          assert.equal(e.content,figure?expected.replace('Contoh:','Contoh:\n'+figure.transcription+'\n'):expected);
        }
        raw.subelemen.forEach((child,j)=>assert.equal(e.subelements![j].content,separateElementLabel(child.nama,child.teks)));
      }
      const saved={id:'teacher-'+record.id,academicSettingId:record.id,generalDescription:result.generalDescription,elements:result.elements,source:result.sourceMeta,updatedAt:stamp};
      assert.equal(validateCPDataWorkflow(saved).issues.length,0,'Step 03 CP workflow '+record.id);
      assert.deepEqual(validateCP4Input(saved.elements),[],'Step 04 accepts canonical input');
      // Test-only teacher-authored rows exercise the existing Step 04 -> 05
      // lineage contract; no AI call or production TP generation is performed.
      const analysis={id:'analysis-'+record.id,academicSettingId:record.id,cpId:saved.id,basedOnCpUpdatedAt:stamp,updatedAt:stamp,
        items:saved.elements.map((e,i)=>({id:'ana-'+record.id+'-'+i,elementId:e.id,elementName:e.name,cpText:e.content,cpCompetence:e.content,materialScope:e.content,meaningfulUnderstanding:e.content,suggestedTp:e.content,order:i+1}))};
      assert.equal(validateCPAnalysisDataWorkflow(analysis,saved).isSiap,true,record.id+' Step 04');
      const tp={id:'tp-'+record.id,academicSettingId:record.id,cpId:saved.id,cpAnalysisId:analysis.id,subjectCode:record.mata_pelajaran,phase:record.fase,academicYear,basedOnCpUpdatedAt:stamp,basedOnAnalysisUpdatedAt:stamp,updatedAt:stamp,
        items:analysis.items.map((a,i)=>({id:'tp-'+record.id+'-'+i,code:`E${i+1}-TST-01`,statement:a.cpText,competence:a.cpCompetence,contentScope:a.materialScope,elementId:a.elementId,elementName:a.elementName,cpAnalysisItemIds:[a.id],order:i+1}))};
      const tpValidation=validateTPDataWorkflow(tp,saved,analysis,context);
      assert.equal(tpValidation.isSiap,true,record.id+' Step 05 '+tpValidation.issues.join('; '));
      if(academicYear==='2025/2026') {
        state.yearPlans.push({id:record.id,profileId:'p',schoolId:'s',academicYear,curriculumType:'KURIKULUM_MERDEKA',subject:record.mata_pelajaran,grade:'Kelas '+record.kelas[0],phase:record.fase,level:'SD',createdAt:stamp,updatedAt:stamp});
        state.workspaces.push({id:'w-'+record.id,yearPlanId:record.id,profileId:'p',schoolId:'s',name:'Teacher CP',createdAt:stamp,updatedAt:stamp});
        state.semesterPlans.push(...[1,2].map(semester=>({id:record.id+'-'+semester,yearPlanId:record.id,semester:semester as 1|2,createdAt:stamp,updatedAt:stamp})));
        state.annualData.cp.push({yearPlanId:record.id,value:saved});
      }
    }
  }
  if(entry) assert.equal(resolveCPContext({sourceSet:'review046',subjectCode:entry.subjectCode,phase:entry.phase,level:'SMP',academicYear:'2025/2026'}).status,'UNRESOLVED');
  console.log('PASS candidate',record.id,integrated?'VERIFIED / integrated':'UNVERIFIED / quarantined');
}
// Every SD catalog subject × A-C × 3 years, including unavailable and ambiguous diagnostics.
for(const phase of ['A','B','C'] as const)for(const academicYear of ['2024/2025','2025/2026','2026/2027']) {
  const context={level:'SD',phase,academicYear};
  for(const subject of getSubjectChoices(context)) {
    const a=getSubjectCPAvailability(subject.code,context);
    assert.notEqual(a.status,'AMBIGUOUS',subject.code+phase+academicYear);
    for(const set of ['review046',undefined] as const) {
      const r=resolveCPContext({subjectCode:subject.code,level:'SD',phase,academicYear,sourceSet:set});
      assert.notEqual(r.status,'AMBIGUOUS');if(r.cp){assert.equal(r.cp.subjectCode,subject.code);assert.equal(r.cp.phase,phase);}
    }
  }
}
// Registry searches and real V5 save/load must not replace teacher edits or hierarchy.
state.annualData.cp[0].value.elements[0].content='TEKS CP GURU TERSIMPAN - jangan diganti otomatis';
const teacherSnapshot=JSON.stringify(state.annualData.cp);
saveStorageV5(state);const loaded=loadStorageV5();
assert.equal(JSON.stringify(loaded.annualData.cp),teacherSnapshot);
for(const record of source.records)cpSourceRepository.searchSourceChoices({level:'SD',subject:record.mata_pelajaran,phase:record.fase,academicYear:'2025/2026'});
assert.equal(JSON.stringify(loadStorageV5().annualData.cp),teacherSnapshot);
assert.equal(hash(ALL_MASTER_CP_ENTRIES),baseline.historicalHash);
console.log('PASS 38 individual candidates; 37 integrated / BING C quarantined; SD catalog × A-C × three years; original resolver snapshots except audited Coding B; 37 CP V5 persistence and teacher-edit preservation.');

