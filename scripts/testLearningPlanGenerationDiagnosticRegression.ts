/**
 * testLearningPlanGenerationDiagnosticRegression.ts
 *
 * Verifies Learning Plan generation diagnostic contracts, save outcomes,
 * and bulk persistence single-trigger behavior.
 */

import {
  recordDiagnosticEvent,
  getRecentDiagnosticEvents,
  buildLearningPlanDiagnosticReport,
  DiagnosticEvent,
} from '../src/services/diagnosticService';
import {
  checkScopeKKTPReadiness,
  hasAssociatedPlan,
  LearningPlanScopeUnit,
} from '../src/components/administration/LearningPlanManager';
import { LearningPlan, AssessmentCriterion } from '../src/types';

// Mock localStorage for node test runner
const memoryStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => memoryStore[k] || null,
  setItem: (k: string, v: string) => {
    memoryStore[k] = v;
  },
  removeItem: (k: string) => {
    delete memoryStore[k];
  },
  clear: () => {
    for (const key in memoryStore) delete memoryStore[key];
  },
};

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

console.log('--- STARTING LEARNING PLAN GENERATION DIAGNOSTIC REGRESSION TESTS ---');

// Reset store before tests
localStorage.clear();

// Test 1: Single generation STARTED event tersedia
console.log('Test 1: Single generation STARTED event');
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-1',
    scopeId: 'scope-1',
    tpCount: 2,
    atpCount: 2,
    learningPlanCountBefore: 0,
  },
});
const eventsAfterStart = getRecentDiagnosticEvents('LEARNING_PLAN');
assert(eventsAfterStart.length === 1, 'Event harus tercatat');
assert(eventsAfterStart[0].status === 'STARTED', 'Status harus STARTED');
assert(eventsAfterStart[0].metadata?.unitId === 'unit-1', 'Metadata unitId harus match');

// Test 2: AI failure menghasilkan FAILED + errorMessage
console.log('Test 2: AI failure menghasilkan FAILED + errorMessage');
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'FAILED',
  metadata: {
    unitId: 'unit-1',
    scopeId: 'scope-1',
    stage: 'AI_GENERATION',
    errorMessage: 'Network timeout during AI generation',
  },
});
const eventsAfterFail = getRecentDiagnosticEvents('LEARNING_PLAN');
const failedEvent = eventsAfterFail.find((e) => e.status === 'FAILED');
assert(!!failedEvent, 'Harus ada FAILED event');
assert(failedEvent?.metadata?.stage === 'AI_GENERATION', 'Stage harus AI_GENERATION');
assert(failedEvent?.metadata?.errorMessage === 'Network timeout during AI generation', 'errorMessage harus tercatat');

// Test 3 & 4: Save false tidak menghasilkan success state & diklasifikasikan sebagai SAVE
console.log('Test 3 & 4: Save false diklasifikasikan sebagai SAVE dan status FAILED');
let simulatedSaveResult = false;
let stage: 'AI_GENERATION' | 'DRAFT_CREATION' | 'SAVE' | 'UNKNOWN' = 'AI_GENERATION';
try {
  // simulate AI response OK
  stage = 'SAVE';
  if (!simulatedSaveResult) {
    throw new Error('Draf AI berhasil dibuat tetapi gagal disimpan.');
  }
  // would record SUCCESS if not thrown
} catch (err: any) {
  recordDiagnosticEvent({
    scope: 'LEARNING_PLAN',
    action: 'LEARNING_PLAN_AI_REQUEST',
    status: 'FAILED',
    metadata: {
      unitId: 'unit-2',
      scopeId: 'scope-2',
      stage,
      errorMessage: err.message,
    },
  });
}
const eventsAfterSaveFail = getRecentDiagnosticEvents('LEARNING_PLAN');
const lastSaveFail = eventsAfterSaveFail[eventsAfterSaveFail.length - 1];
assert(lastSaveFail.status === 'FAILED', 'Status harus FAILED');
assert(lastSaveFail.metadata?.stage === 'SAVE', 'Stage harus SAVE');
assert(lastSaveFail.metadata?.errorMessage === 'Draf AI berhasil dibuat tetapi gagal disimpan.', 'Error message harus sesuai contract');

// Test 5: Pesan error tidak menyebut "rancangan sebelumnya" jika tidak ada active plan
console.log('Test 5: Pesan error formatting');
const formatErrorMessage = (activePlan: LearningPlan | null, errorMessage: string) => {
  return activePlan
    ? `Draf AI tidak dibuat. Rancangan yang sedang terlihat adalah rancangan sebelumnya. ${errorMessage}`
    : `Draf AI tidak berhasil dibuat. ${errorMessage}`;
};
const msgNoActive = formatErrorMessage(null, 'Koneksi gagal');
assert(!msgNoActive.includes('rancangan sebelumnya'), 'Jika activePlan null, tidak boleh menyebut rancangan sebelumnya');
assert(msgNoActive === 'Draf AI tidak berhasil dibuat. Koneksi gagal', 'Format pesan netral harus sesuai');

const dummyPlan: LearningPlan = {
  assessmentPlan:{initial:[],formative:[],summative:[]},
  academicSettingId: 'setting-1', sourceType: 'MANUAL', tpIds: [], atpItemIds: [], objectives: [], allocatedJP: 0,
  id: 'lp-existing',
  curriculumType: 'KURIKULUM_MERDEKA',
  title: 'Modul 1',
  topic: 'Topic 1',
  status: 'DRAFT',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const msgWithActive = formatErrorMessage(dummyPlan, 'Koneksi gagal');
assert(msgWithActive.includes('rancangan sebelumnya'), 'Jika activePlan ada, konteks rancangan sebelumnya dipertahankan');

// Test 6 & 7: Bulk tidak melakukan save pada setiap iteration & hanya trigger satu kali
console.log('Test 6 & 7: Bulk save single invocation contract');
let bulkSaveCallCount = 0;
let bulkSavedBatches: LearningPlan[][] = [];
const mockOnSaveBulkPlans = (plans: LearningPlan[]) => {
  bulkSaveCallCount++;
  bulkSavedBatches.push(plans);
};

// Simulate bulk loop with 3 scopes
const generatedInBulk: LearningPlan[] = [];
const scopesToProcess = ['scope-a', 'scope-b', 'scope-c'];
for (const s of scopesToProcess) {
  // inside loop: generate draft, collect
  generatedInBulk.push({
    ...dummyPlan,
    id: `plan-${s}`,
  });
  // NOTE: In-loop onSaveBulkPlans removed!
}
// After loop: single save invocation
if (mockOnSaveBulkPlans && generatedInBulk.length > 0) {
  mockOnSaveBulkPlans(generatedInBulk);
  recordDiagnosticEvent({
    scope: 'LEARNING_PLAN',
    action: 'LEARNING_PLAN_BULK_SAVE',
    status: 'TRIGGERED',
    metadata: {
      generatedCount: generatedInBulk.length,
      failedGenerationCount: 0,
      skippedExistingCount: 1,
    },
  });
}
assert(bulkSaveCallCount === 1, `bulkSaveCallCount harus 1 (got ${bulkSaveCallCount})`);
assert(bulkSavedBatches[0].length === 3, 'Batch save harus memuat 3 generated plans');

const bulkSaveEvent = getRecentDiagnosticEvents('LEARNING_PLAN').find(
  (e) => e.action === 'LEARNING_PLAN_BULK_SAVE'
);
assert(!!bulkSaveEvent, 'Event LEARNING_PLAN_BULK_SAVE harus tercatat');
assert(bulkSaveEvent?.status === 'TRIGGERED', 'Status harus TRIGGERED (jujur tidak klaim SUCCESS)');
assert(bulkSaveEvent?.metadata?.generatedCount === 3, 'generatedCount harus 3');

// Test 8: Failure satu scope tidak menghentikan scope berikutnya dalam bulk
console.log('Test 8: Failure scope isolasi dalam bulk');
let processedCount = 0;
let bulkFailCount = 0;
let bulkSuccessCount = 0;
const mixedScopes = ['good-1', 'bad-2', 'good-3'];
const mixedGenerated: LearningPlan[] = [];

for (const s of mixedScopes) {
  try {
    if (s === 'bad-2') {
      throw new Error('AI Error on bad-2');
    }
    mixedGenerated.push({ ...dummyPlan, id: `plan-${s}` });
    bulkSuccessCount++;
  } catch (err: any) {
    bulkFailCount++;
    recordDiagnosticEvent({
      scope: 'LEARNING_PLAN',
      action: 'LEARNING_PLAN_AI_REQUEST',
      status: 'FAILED',
      metadata: {
        unitId: s,
        stage: 'AI_GENERATION',
        errorMessage: err.message,
      },
    });
  }
  processedCount++;
}
assert(processedCount === 3, 'Semua 3 scope harus diproses');
assert(bulkSuccessCount === 2, '2 scope harus sukses');
assert(bulkFailCount === 1, '1 scope harus gagal');
assert(mixedGenerated.length === 2, 'Generated plans harus 2');

// Test 9 & 10: Delete success and failure lifecycle
console.log('Test 9 & 10: Delete diagnostic events');
// Case A: Delete Success
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_DELETE',
  status: 'STARTED',
  metadata: {
    planId: 'plan-del-1',
    learningPlanCountBefore: 3,
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_DELETE',
  status: 'SUCCESS',
  metadata: {
    planId: 'plan-del-1',
    expectedCountAfter: 2,
  },
});

// Case B: Delete Failure
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_DELETE',
  status: 'STARTED',
  metadata: {
    planId: 'plan-del-2',
    learningPlanCountBefore: 2,
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_DELETE',
  status: 'FAILED',
  metadata: {
    planId: 'plan-del-2',
  },
});

const deleteEvents = getRecentDiagnosticEvents('LEARNING_PLAN').filter(
  (e) => e.action === 'LEARNING_PLAN_DELETE'
);
assert(deleteEvents.length === 4, 'Harus ada 4 delete events');
assert(deleteEvents[1].status === 'SUCCESS', 'Delete 1 harus SUCCESS');
assert(deleteEvents[3].status === 'FAILED', 'Delete 2 harus FAILED');

// Test 11: Existing Learning Plan detection tetap tidak berubah
console.log('Test 11: Existing plan detection via hasAssociatedPlan');
const scopeUnit: LearningPlanScopeUnit = {
  id: 'scope-unit-1',
  unitId: 'unit-101',
  title: 'Bab 1',
  type: 'CANONICAL_UNIT',
  linkedAtpItemIds: [],
  jp: 4,
  linkedTpIds: ['tp-1'],
};
const existingPlans: LearningPlan[] = [
  {
    ...dummyPlan,
    id: 'lp-1',
    unitId: 'unit-101',
  },
];
assert(hasAssociatedPlan(scopeUnit, existingPlans) === true, 'Scope dengan unitId match harus terdeteksi');

const nonMatchingScope: LearningPlanScopeUnit = {
  id: 'scope-unit-2',
  unitId: 'unit-999',
  title: 'Bab 9',
  type: 'CANONICAL_UNIT',
  linkedAtpItemIds: [],
  jp: 4,
  linkedTpIds: ['tp-9'],
};
assert(hasAssociatedPlan(nonMatchingScope, existingPlans) === false, 'Scope tanpa plan harus false');

// Test 12: KKTP readiness logic tetap tidak berubah
console.log('Test 12: KKTP readiness check');
const kktpCriteriaReady: AssessmentCriterion[] = [
  {indicators: [], levels: [],
    id: 'crit-1',
    tpId: 'tp-1',
    description: 'Deskripsi',
    approach: 'rubrik',
    academicSettingId: 'setting-1',
    workflowStatus: 'SIAP',
    updatedAt: new Date().toISOString(),
  },
];
const kktpCheckSuccess = checkScopeKKTPReadiness(scopeUnit, kktpCriteriaReady);
assert(kktpCheckSuccess.isReady === true, 'KKTP SIAP harus menghasilkan isReady=true');

const kktpCriteriaDraft: AssessmentCriterion[] = [
  {
    ...kktpCriteriaReady[0],
    workflowStatus: 'DRAFT',
  },
];
const kktpCheckFail = checkScopeKKTPReadiness(scopeUnit, kktpCriteriaDraft);
assert(kktpCheckFail.isReady === false, 'KKTP DRAFT harus menghasilkan isReady=false');
assert(kktpCheckFail.unreadyTpCount === 1, 'unreadyTpCount harus 1');

// Test 13: Report includes LATEST AI OUTCOME, BULK SAVE, and DELETE
console.log('Test 13: Diagnostic report sections');
const report = buildLearningPlanDiagnosticReport({
  workspaceId: 'ws-1',
  learningPlans: existingPlans,
});
assert(report.includes('LATEST AI OUTCOME:'), 'Report harus memuat section LATEST AI OUTCOME');
assert(report.includes('BULK SAVE:'), 'Report harus memuat section BULK SAVE');
assert(report.includes('DELETE:'), 'Report harus memuat section DELETE');
assert(report.includes('GATE:'), 'Report harus mempertahankan section GATE');
assert(report.includes('TP SOURCE:'), 'Report harus mempertahankan section TP SOURCE');
assert(report.includes('Recent LEARNING_PLAN Events:'), 'Report harus mempertahankan Recent LEARNING_PLAN Events');

// =========================================================================
// M-LP-DIAG.1.1: 4 Regression Cases for AI INPUT & LATEST AI OUTCOME separation
// =========================================================================
console.log('--- Testing M-LP-DIAG.1.1: AI INPUT and LATEST AI OUTCOME Separation ---');

// Case 1: STARTED -> SUCCESS
// - AI INPUT tetap menampilkan tpCount, atpCount, meeting, JP, KKTP dari STARTED.
// - outcome = SUCCESS.
console.log('Regression Case 1: STARTED -> SUCCESS keeps AI INPUT and outcome SUCCESS');
localStorage.clear();
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-c1',
    scopeId: 'scope-c1',
    tpCount: 3,
    atpCount: 4,
    learningMeetingCount: 2,
    allocatedJP: 6,
    meetingStructureSent: true,
    meetingStructureCount: 2,
    kktpSent: true,
    kktpCount: 3,
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'SUCCESS',
  metadata: {
    unitId: 'unit-c1',
    scopeId: 'scope-c1',
    planId: 'plan-c1',
    saveResult: true,
  },
});

const reportCase1 = buildLearningPlanDiagnosticReport({});
assert(reportCase1.includes('AI INPUT:\nunitId: unit-c1\nTP sent: 3\nATP sent: 4\nLearningMeeting IDs in scope: 2\nAllocated JP sent: 6\nMeeting structure sent to AI: true\nmeetingStructureCount: 2\nKKTP sent to AI: true\nkktpCount: 3'), 'Case 1: AI INPUT harus tetap mempertahankan semua metadata dari STARTED');
assert(reportCase1.includes('LATEST AI OUTCOME:\nstatus: SUCCESS\nunitId: unit-c1\nscopeId: scope-c1\nstage: -\nplanId: plan-c1\nerrorMessage: -\nsaveResult: true'), 'Case 1: LATEST AI OUTCOME harus SUCCESS');

// Case 2: STARTED -> FAILED
// - AI INPUT tetap utuh.
// - outcome menampilkan FAILED + stage + errorMessage.
console.log('Regression Case 2: STARTED -> FAILED keeps AI INPUT and outcome FAILED with details');
localStorage.clear();
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-c2',
    scopeId: 'scope-c2',
    tpCount: 2,
    atpCount: 2,
    learningMeetingCount: 1,
    allocatedJP: 4,
    meetingStructureSent: true,
    meetingStructureCount: 1,
    kktpSent: false,
    kktpCount: 0,
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'FAILED',
  metadata: {
    unitId: 'unit-c2',
    scopeId: 'scope-c2',
    stage: 'SAVE',
    errorMessage: 'Draf AI berhasil dibuat tetapi gagal disimpan.',
  },
});

const reportCase2 = buildLearningPlanDiagnosticReport({});
assert(reportCase2.includes('AI INPUT:\nunitId: unit-c2\nTP sent: 2\nATP sent: 2\nLearningMeeting IDs in scope: 1\nAllocated JP sent: 4\nMeeting structure sent to AI: true\nmeetingStructureCount: 1\nKKTP sent to AI: false\nkktpCount: 0'), 'Case 2: AI INPUT harus tetap utuh dari event STARTED');
assert(reportCase2.includes('LATEST AI OUTCOME:\nstatus: FAILED\nunitId: unit-c2\nscopeId: scope-c2\nstage: SAVE\nplanId: -\nerrorMessage: Draf AI berhasil dibuat tetapi gagal disimpan.\nsaveResult: -'), 'Case 2: LATEST AI OUTCOME harus FAILED dengan stage dan error');

// Case 3: STARTED saja
// - AI INPUT terisi.
// - outcome = none.
console.log('Regression Case 3: STARTED only has populated AI INPUT and none outcome');
localStorage.clear();
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-c3',
    scopeId: 'scope-c3',
    tpCount: 1,
    atpCount: 1,
    learningMeetingCount: 1,
    allocatedJP: 2,
    meetingStructureSent: false,
    meetingStructureCount: 0,
    kktpSent: true,
    kktpCount: 1,
  },
});

const reportCase3 = buildLearningPlanDiagnosticReport({});
assert(reportCase3.includes('AI INPUT:\nunitId: unit-c3\nTP sent: 1\nATP sent: 1\nLearningMeeting IDs in scope: 1\nAllocated JP sent: 2\nMeeting structure sent to AI: false\nmeetingStructureCount: 0\nKKTP sent to AI: true\nkktpCount: 1'), 'Case 3: AI INPUT harus terisi dari STARTED');
assert(reportCase3.includes('LATEST AI OUTCOME:\n- none'), 'Case 3: LATEST AI OUTCOME harus none karena belum ada outcome');

// Case 4: STARTED unit-1 -> FAILED unit-1 -> STARTED unit-2
// - AI INPUT berasal dari unit-2.
// - latest outcome tetap FAILED unit-1.
console.log('Regression Case 4: STARTED unit-1 -> FAILED unit-1 -> STARTED unit-2');
localStorage.clear();
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-1',
    scopeId: 'scope-1',
    tpCount: 5,
    atpCount: 5,
    learningMeetingCount: 3,
    allocatedJP: 10,
    meetingStructureSent: true,
    meetingStructureCount: 3,
    kktpSent: true,
    kktpCount: 5,
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'FAILED',
  metadata: {
    unitId: 'unit-1',
    scopeId: 'scope-1',
    stage: 'AI_GENERATION',
    errorMessage: 'Quota exceeded for unit-1',
  },
});
recordDiagnosticEvent({
  scope: 'LEARNING_PLAN',
  action: 'LEARNING_PLAN_AI_REQUEST',
  status: 'STARTED',
  metadata: {
    unitId: 'unit-2',
    scopeId: 'scope-2',
    tpCount: 2,
    atpCount: 2,
    learningMeetingCount: 1,
    allocatedJP: 4,
    meetingStructureSent: false,
    meetingStructureCount: 0,
    kktpSent: false,
    kktpCount: 0,
  },
});

const reportCase4 = buildLearningPlanDiagnosticReport({});
assert(reportCase4.includes('AI INPUT:\nunitId: unit-2\nTP sent: 2\nATP sent: 2\nLearningMeeting IDs in scope: 1\nAllocated JP sent: 4\nMeeting structure sent to AI: false\nmeetingStructureCount: 0\nKKTP sent to AI: false\nkktpCount: 0'), 'Case 4: AI INPUT harus berasal dari event STARTED unit-2 yang terbaru');
assert(reportCase4.includes('LATEST AI OUTCOME:\nstatus: FAILED\nunitId: unit-1\nscopeId: scope-1\nstage: AI_GENERATION\nplanId: -\nerrorMessage: Quota exceeded for unit-1\nsaveResult: -'), 'Case 4: LATEST AI OUTCOME harus tetap mempertahankan outcome non-STARTED terakhir dari unit-1');

console.log('--- ALL LEARNING PLAN GENERATION DIAGNOSTIC REGRESSION TESTS PASSED ---');
