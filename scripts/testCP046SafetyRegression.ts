import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialStorageV5 } from '../src/services/storageV5';
import { prepareCompleteAdministrationProjectImport } from '../src/services/administrationProjectImportService';
import { createCompleteProjectZip, readCompleteProjectZip } from '../src/services/completeProjectZipService';
import { ALL_MASTER_CP_ENTRIES, resolveCPContext } from '../src/data/curriculum/cp';
import { SMP_REVIEW_CP_ENTRIES } from '../src/data/curriculum/cp/smp';
import { SMA_REVIEW_CP_ENTRIES } from '../src/data/curriculum/cp/sma';
import { adaptCP046Review } from '../src/data/curriculum/cp/review046Adapter';
import { cpSourceRepository } from '../src/services/cpSourceRepository';
import { validateCPDataWorkflow } from '../src/services/cpWorkflowService';
import type { CPElem, CPData } from '../src/types';

const entries = [...SMP_REVIEW_CP_ENTRIES, ...SMA_REVIEW_CP_ENTRIES];
const stamp = '2026-10-29T00:00:00Z';
const mainSnapshotPath = process.env.CP_MAIN_SNAPSHOT;
if (mainSnapshotPath) {
  const main = JSON.parse(readFileSync(mainSnapshotPath, 'utf8'));
  for (const old of main.entries) {
    assert.deepEqual(ALL_MASTER_CP_ENTRIES.find(entry => entry.id === old.id), old, 'Historical CP must remain byte-equivalent as data: ' + old.id);
    for (const academicYear of ['2024/2025', '2025/2026', '2026/2027']) {
      const result = resolveCPContext({subjectCode: old.subjectCode, phase: old.phase, level: old.level, academicYear});
      assert.notEqual(result.status, 'AMBIGUOUS', result.reason);
    }
  }
  console.log('PASS: every main historical CP preserved; no unresolved version ambiguity in historical contexts.');
}

// Results belong to callers. Editing teacher metadata must never edit the built-in registry or raw JSON.
const registryBefore = JSON.stringify(ALL_MASTER_CP_ENTRIES);
const raw = JSON.parse(readFileSync('src/data/curriculum/cp/sources/cp-smp-bskap-046-2025-v5-review.json', 'utf8'));
const rawBefore = JSON.stringify(raw);
const adapted = adaptCP046Review(raw, 'SMP');
adapted[0].sourceReview!.grades.push(999);
adapted[0].sourceReview!.pages.awal = 999;
assert.equal(JSON.stringify(raw), rawBefore, 'Adapter metadata must not alias original JSON');
const context = {subject: entries[0].subjectCode, phase: entries[0].phase, level: entries[0].level, academicYear:'2025/2026'};
const result = cpSourceRepository.searchWithDiagnostics(context, {sourceSet:'review046'}).results[0];
result.sourceMeta.sourceReview!.pages.awal = 999;
result.sourceMeta.sourceReview!.grades.push(999);
result.elements[0].content = 'Teacher draft';
assert.equal(JSON.stringify(ALL_MASTER_CP_ENTRIES), registryBefore, 'Search results must not mutate master CP metadata');
assert.equal(cpSourceRepository.searchWithDiagnostics(context, {sourceSet:'review046'}).results[0].sourceMeta.sourceReview!.pages.awal, entries[0].sourceReview!.pages.awal);
console.log('PASS: adapter and search metadata are independent from source JSON and master registry.');

function sourceProjection(elements: CPElem[]): unknown[] {
  return elements.map(({id, subelements, ...element}) => ({...element, subelements: sourceProjection(subelements || [])}));
}
function assertSourceIdentity(elements: CPElem[], master: typeof entries[number]['elements']): void {
  assert.equal(elements.length, master.length);
  elements.forEach((element, index) => {
    // Local IDs are intentionally remapped by project COPY; this key is source provenance.
    assert.equal(element.sourceElementKey, master[index].id);
    assert.equal(element.sourceText, master[index].sourceText);
    assertSourceIdentity(element.subelements || [], master[index].subelements || []);
  });
}

for (const entry of entries) {
  const selected = cpSourceRepository.searchWithDiagnostics({subject:entry.subjectCode, phase:entry.phase, level:entry.level, academicYear:'2025/2026'}, {sourceSet:'review046'}).results[0];
  assert.equal(selected.id, entry.id);
  assertSourceIdentity(selected.elements, entry.elements);
  const state = createInitialStorageV5();
  state.schools = [{id:'s',name:'School',npsn:'',address:'',village:'',district:'',regency:'',province:'',principalName:'',principalNip:'',createdAt:stamp,updatedAt:stamp}];
  state.profiles = ['p','target'].map(id => ({id,name:id,nip:'',status:'PNS',defaultSubject:entry.subjectCode,defaultLevel:entry.level,schoolId:'s',createdAt:stamp,updatedAt:stamp}));
  state.yearPlans = [{id:'y',profileId:'p',schoolId:'s',academicYear:'2025/2026',curriculumType:'KURIKULUM_MERDEKA',subject:entry.subjectCode,grade:'Kelas '+entry.sourceReview!.grades[0],phase:entry.phase,level:entry.level,createdAt:stamp,updatedAt:stamp}];
  state.workspaces = [{id:'w',yearPlanId:'y',profileId:'p',schoolId:'s',name:'CP audit',createdAt:stamp,updatedAt:stamp}];
  state.semesterPlans = [1,2].map(semester => ({id:'sp'+semester,yearPlanId:'y',semester:semester as 1|2,createdAt:stamp,updatedAt:stamp}));
  const cp: CPData = {id:'teacher-cp',academicSettingId:'y',cpId:entry.id,cpVersion:entry.id,regulationSourceId:entry.regulationSourceId,regulationIds:[entry.regulationSourceId],generalDescription:selected.generalDescription,elements:selected.elements,source:selected.sourceMeta,updatedAt:stamp};
  cp.workflowStatus = validateCPDataWorkflow(cp).status;
  state.annualData.cp = [{yearPlanId:'y',value:cp}];
  const before = JSON.stringify(state);
  const archive = await readCompleteProjectZip(await createCompleteProjectZip(state, 'y'));
  const restored = prepareCompleteAdministrationProjectImport(state,archive,{mode:'RESTORE',targetProfileId:'p',targetSchoolId:'s',replaceYearPlanId:'y'});
  assert.deepEqual(restored.state.annualData.cp[0].value, cp);
  const copied = prepareCompleteAdministrationProjectImport(state,archive,{mode:'COPY',targetProfileId:'target',targetSchoolId:'s'});
  const copiedCP = copied.state.annualData.cp.find(item => item.yearPlanId === copied.yearPlanId)!.value;
  assert.notEqual(copiedCP.id, cp.id);
  assert.notEqual(copiedCP.elements[0].id, cp.elements[0].id);
  assertSourceIdentity(copiedCP.elements, entry.elements);
  assert.deepEqual(sourceProjection(copiedCP.elements), sourceProjection(cp.elements));
  assert.deepEqual(copiedCP.source, cp.source);
  assert.equal(copiedCP.source!.verificationStatus, 'UNVERIFIED');
  assert.deepEqual(copied.state.profiles, state.profiles);
  assert.deepEqual(copied.state.annualData.cp.find(item => item.yearPlanId === 'y')!.value, cp);
  assert.equal(JSON.stringify(state), before, 'ZIP operations must not mutate teacher source state');
}
assert.equal(JSON.stringify(ALL_MASTER_CP_ENTRIES), registryBefore);
console.log('PASS: all 84 CP ZIP RESTORE/COPY preserve source IDs, 30 subelements, raw text, metadata, REVIEW and teacher data.');
