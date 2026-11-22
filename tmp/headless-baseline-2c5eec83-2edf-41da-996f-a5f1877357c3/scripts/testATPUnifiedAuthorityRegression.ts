import assert from 'node:assert';
import {
  validateATPDataWorkflow,
  validateATPReferences,
  resolveATPItemTPReferences,
} from '../src/services/cpWorkflowService';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import {
  ATPData,
  ATPItem,
  TPData,
  TPItem,
  CPData,
  CPAnalysisData,
  AcademicSetting,
  TeacherProfile,
  SchoolData,
} from '../src/types';

console.log('=== RUNNING ATP UNIFIED AUTHORITY REGRESSION TESTS ===\n');

const mockAcademicSetting: AcademicSetting = {
  id: 'acad-001',
  profileId: 'prof-001',
  academicYear: '2025/2026',
  semester: '1 (Ganjil)',
  grade: 'Kelas 4',
  phase: 'B',
  level: 'SD',
  subject: 'Matematika',
  curriculum: 'Kurikulum Merdeka',
  totalHoursPerWeek: 4,
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockCP: CPData = {
  id: 'cp-001',
  source:{title:'Fixture CP manual untuk pengujian',institution:'Fixture',retrievedAt:'2026-01-01T00:00:00Z',verificationStatus:'UNVERIFIED'},
  academicSettingId: 'acad-001',
  generalDescription: 'Peserta didik dapat memahami bilangan cacah dan pecahan sederhana.',
  elements: [{ id: 'elem-1', name: 'Bilangan', content: 'Memahami bilangan cacah.' }, {id:'elem-2',name:'Pecahan',content:'Memahami pecahan senilai.'}],
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockCPAnalysis: CPAnalysisData = {
  id: 'cpa-001',
  cpId:'cp-001',
  academicSettingId: 'acad-001',
  generalSummary: 'Analisis bilangan cacah.',
  items: [
    {
      id: 'ana-001',
      scopeCode:'BLG',meaningfulUnderstanding:'Memahami bilangan cacah berkaitan dengan nilai bilangan cacah.',
      elementId: 'elem-1',
      elementName: 'Bilangan',
      cpText: 'Memahami bilangan cacah.',
      cpCompetence: 'Memahami',
      materialScope: 'Bilangan Cacah',
      suggestedTp: 'Peserta didik memahami bilangan cacah sampai 10.000.',
      order: 1,
    },
    {
      id: 'ana-002',
      scopeCode:'PCH',meaningfulUnderstanding:'Memahami pecahan senilai berkaitan dengan kesamaan nilai pecahan.',
      elementId: 'elem-2',
      elementName: 'Pecahan',
      cpText: 'Memahami pecahan senilai.',
      cpCompetence: 'Memahami',
      materialScope: 'Pecahan Senilai',
      suggestedTp: 'Peserta didik memahami pecahan senilai.',
      order: 2,
    },
  ],
  basedOnCpUpdatedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockTPItems: TPItem[] = [
  {
    id: 'tp-001',
    code: 'E1-BLG-01',
    elementName: 'Bilangan',
    statement: 'Peserta didik memahami bilangan cacah sampai 10.000.',
    competence: 'Memahami',
    contentScope: 'Bilangan Cacah',
    cpAnalysisId: 'ana-001',
    cpAnalysisItemIds: ['ana-001'],
    p3Dimensions: ['Mandiri'],
    order: 1,
  },
  {
    id: 'tp-002',
    code: 'E1-BLG-02',
    elementName: 'Bilangan',
    statement: 'Peserta didik memahami konsep pecahan senilai.',
    competence: 'Memahami',
    contentScope: 'Pecahan Senilai',
    cpAnalysisId: 'ana-002',
    cpAnalysisItemIds: ['ana-002'],
    p3Dimensions: ['Bernalar Kritis'],
    order: 2,
  },
];

const mockTPData: TPData = {
  id: 'tp-data-001',
  academicSettingId: 'acad-001',
  cpId: 'cp-001',
  cpAnalysisId: 'cpa-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  items: mockTPItems,
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  basedOnCpUpdatedAt: '2026-01-01T00:00:00Z',
  basedOnAnalysisUpdatedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

const validATPItems: ATPItem[] = [
  {
    id: 'atp-item-1',
    stepNumber: 1,
    linkedTpIds: ['tp-001'],
    focus: 'Memahami bilangan cacah sampai 10.000',
    tpCode: 'E1-BLG-01',
    tpStatement: mockTPItems[0].statement,
  },
  {
    id: 'atp-item-2',
    stepNumber: 2,
    linkedTpIds: ['tp-002'],
    focus: 'Memahami konsep pecahan senilai',
    tpCode: 'E1-BLG-02',
    tpStatement: mockTPItems[1].statement,
  },
];

const mockValidATP: ATPData = {
  id: 'atp-001',
  academicSettingId: 'acad-001',
  tpId: 'tp-data-001',
  tpDataId: 'tp-data-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  rationale: 'Alur dari konkret ke abstrak.',
  items: validATPItems,
  workflowStatus: 'SIAP',
  generatedBy: 'TEACHER',
  needsReview: false,
  basedOnTpUpdatedAt: mockTPData.updatedAt,
  updatedAt: '2026-01-03T00:00:00Z',
};

// 1. Valid ATP should be SIAP
console.log('--- 1. Canonical Valid ATP ---');
const val1 = validateATPDataWorkflow(mockValidATP, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val1.isSiap, true, `Valid ATP must be SIAP: ${val1.issues.join('; ')}`);
assert.strictEqual(val1.status, 'SIAP');
console.log('✅ 1. Canonical valid ATP is SIAP');

// 2. Upstream TP Not SIAP Blocks ATP
console.log('--- 2. Upstream TP Readiness Authority ---');
const unreadyTP: TPData = {
  ...mockTPData,
  workflowStatus: 'PERLU_DILENGKAPI',
};
const val2 = validateATPDataWorkflow(mockValidATP, unreadyTP, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val2.isSiap, false, 'Unready TP must block ATP from being SIAP');
console.log('✅ 2. TP not SIAP blocks ATP from being SIAP');

// 3. Upstream TP Needs Review Blocks ATP
console.log('--- 3. Upstream TP Needs Review ---');
const reviewedTP: TPData = {
  ...mockTPData,
  needsReview: true,
  reviewReason: 'CP telah berubah',
};
const val3 = validateATPDataWorkflow(mockValidATP, reviewedTP, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val3.isSiap, false, 'TP needsReview must block ATP from being SIAP');
console.log('✅ 3. TP needsReview blocks ATP');

// 4. ATP with Empty Focus is Rejected
console.log('--- 4. Focus Non-Empty Requirement ---');
const atpEmptyFocus: ATPData = {
  ...mockValidATP,
  items: [
    { ...validATPItems[0], focus: '' },
    validATPItems[1],
  ],
};
const val4 = validateATPDataWorkflow(atpEmptyFocus, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val4.isSiap, false, 'Empty focus must block ATP from being SIAP');
assert.ok(val4.issues.some((iss) => iss.includes('fokus langkah pembelajaran')));
console.log('✅ 4. Empty focus is rejected');

// 5. ATP DRAFT Status Cannot be SIAP
console.log('--- 5. ATP DRAFT Status ---');
const atpDraft: ATPData = {
  ...mockValidATP,
  workflowStatus: 'DRAFT',
};
const val5 = validateATPDataWorkflow(atpDraft, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val5.isSiap, false, 'DRAFT ATP cannot be SIAP without teacher confirmation');
assert.strictEqual(val5.status, 'DRAFT');
console.log('✅ 5. DRAFT ATP status correctly preserved');

// 6. ATP Missing TP Coverage
console.log('--- 6. Missing TP Coverage ---');
const atpPartial: ATPData = {
  ...mockValidATP,
  items: [validATPItems[0]], // Missing tp-002
};
const val6 = validateATPDataWorkflow(atpPartial, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val6.isSiap, false, 'Missing TP coverage must block ATP');
assert.ok(val6.issues.some((iss) => iss.includes('MISSING_TP_REFERENCE')));
console.log('✅ 6. Missing TP coverage is rejected');

// 7. ATP Dangling Reference
console.log('--- 7. Dangling TP Reference ---');
const atpDangling: ATPData = {
  ...mockValidATP,
  items: [
    validATPItems[0],
    {
      id: 'atp-item-dang',
      stepNumber: 2,
      linkedTpIds: ['non-existent-tp-id'],
      focus: 'Fokus Dangling',
    },
  ],
};
const val7 = validateATPDataWorkflow(atpDangling, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val7.isSiap, false, 'Dangling TP reference must block ATP');
console.log('✅ 7. Dangling reference is rejected');

// 8. ATP Stale against TP
console.log('--- 8. Stale against TP UpdatedAt ---');
const atpStale: ATPData = {
  ...mockValidATP,
  basedOnTpUpdatedAt: '2026-01-01T00:00:00Z', // older than mockTPData.updatedAt (2026-01-02)
};
const val8 = validateATPDataWorkflow(atpStale, mockTPData, mockAcademicSetting, mockCP, mockCPAnalysis);
assert.strictEqual(val8.isSiap, false, 'Stale ATP must not be SIAP');
console.log('✅ 8. Stale ATP is rejected');

// 9. WorkflowEngine Integration
console.log('--- 9. WorkflowEngine Authority Alignment ---');
const mockProfile: TeacherProfile = {
  id: 'prof-001',
  name: 'Budi Santoso',
  nip: '19850101',
  status: 'PNS', schoolId: 'sch-001',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  defaultSubject: 'Matematika',
  defaultLevel: 'SD',
};
const mockSchool: SchoolData = {
  id: 'sch-001',
  village: 'Merdeka', district: 'Merdeka', regency: 'Merdeka', province: 'Jawa Barat',
  principalName: 'Kepala Sekolah', principalNip: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  name: 'SD Negeri 1 Merdeka',
  npsn: '12345678',
  address: 'Jl. Pendidikan No. 1',
};

const wfReportValid = validateWorkflowDependencies({
  academicSetting: mockAcademicSetting,
  profile: mockProfile,
  school: mockSchool,
  cp: mockCP,
  cpAnalysis: mockCPAnalysis,
  tp: mockTPData,
  atp: mockValidATP,
});
assert.strictEqual(wfReportValid.stepStates.atp.status, 'COMPLETE');
assert.strictEqual(wfReportValid.stepStates.atp.isComplete, true);

const wfReportUnready = validateWorkflowDependencies({
  academicSetting: mockAcademicSetting,
  profile: mockProfile,
  school: mockSchool,
  cp: mockCP,
  cpAnalysis: mockCPAnalysis,
  tp: mockTPData,
  atp: atpEmptyFocus,
});
assert.strictEqual(wfReportUnready.stepStates.atp.status, 'IN_PROGRESS');
assert.strictEqual(wfReportUnready.stepStates.atp.isComplete, false);

console.log('✅ 9. WorkflowEngine correctly reflects unified validator status');

console.log('\n=== ALL ATP UNIFIED AUTHORITY TESTS PASSED 100% ===');
