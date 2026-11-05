import assert from 'node:assert';
import { fallbackAnalyzeMapping, sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import { validateATPUnitMappingCanonical } from '../src/services/atpUnitMappingValidationService';
import { TPData, ATPData, ATPUnitMappingData } from '../src/types';

console.log('=== RUNNING TESTS: Multi-Bab ATP Mapping Analysis & Deadlock Prevention ===');

// Setup mock data
const mockTPData: TPData = {
  id: 'tp-data-001',
  academicSettingId: 'acad-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  workflowStatus: 'SIAP',
  needsReview: false,
  items: [
    {order: 1, id: 'TP1', code: 'E1-01', statement: 'Memahami bilangan cacah sampai 1000', competence: 'Memahami', contentScope: 'Bilangan' },
    {order: 2, id: 'TP2', code: 'E1-02', statement: 'Melakukan operasi hitung bilangan', competence: 'Menghitung', contentScope: 'Operasi Bilangan' },
    {order: 3, id: 'TP3', code: 'E1-03', statement: 'Memahami pecahan sederhana', competence: 'Memahami', contentScope: 'Pecahan' },
  ],
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockATPData: ATPData = {
  id: 'atp-001',
  academicSettingId: 'acad-001',
  tpId: 'tp-data-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  workflowStatus: 'SIAP',
  needsReview: false,
  basedOnTpUpdatedAt: '2026-01-01T00:00:00Z',
  items: [
    {
      id: 'atp-1',
      stepNumber: 1,
      linkedTpIds: ['TP1', 'TP2', 'TP3'],
      focus: 'Operasi hitung dan pecahan',
      jp: 8,
      semester: 1,
    },
  ],
  updatedAt: '2026-01-01T00:00:00Z',
};

// ==========================================
// CASE A: ATP completely unmapped, Bab 1 relevant
// ==========================================
console.log('Testing Case A: Unmapped ATP -> ASSIGN_ATP_TO_UNIT...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-01',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Operasi Bilangan dan Pecahan',
        order: 1,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [{ id: 'm-1', title: 'Operasi Bilangan Cacah', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const analysis = fallbackAnalyzeMapping({
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  assert.strictEqual(analysis.summary.unmappedAtp, 1, 'ATP should be unmapped');
  const finding = analysis.atpFindings.find((f) => f.atpItemId === 'atp-1');
  assert.ok(finding, 'Finding for atp-1 must exist');
  assert.strictEqual(finding?.status, 'UNMAPPED');
  assert.ok(finding?.action, 'Action must be present');
  assert.strictEqual(finding.action?.type, 'ASSIGN_ATP_TO_UNIT');
  assert.strictEqual(finding.action?.targetUnitId, 'unit-1');
  assert.ok(Array.isArray(finding.action?.linkedTpIds) && finding.action.linkedTpIds.length > 0, 'linkedTpIds must be present');
  console.log('✅ Case A passed');
}

// ==========================================
// CASE B & C: Reproduction of Z=0 deadlock & Subset TP per Bab
// ==========================================
console.log('Testing Case B & C: Z=0 deadlock prevention & multi-Bab subset TP...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-02',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Bilangan',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1', 'TP2'],
        materials: [{ id: 'm-1', title: 'Bilangan Cacah', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1'] }],
      },
      {
        id: 'unit-2',
        title: 'Bab 2: Pecahan Sederhana',
        order: 2,
        linkedAtpItemIds: [], // Z=0 globally because atp-1 is in unit-1, but unit-2 has no lineage
        linkedTpIds: [],
        materials: [{ id: 'm-2', title: 'Pecahan Sederhana', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const analysis = fallbackAnalyzeMapping({
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  // Even though mappedAtp = 1 (totalAtp = 1, so unmapped = 0, Z=0), unit-2 has no lineage and material 'Konsep Pecahan' matches atp-1 topic.
  // Analyzer should recommend ASSIGN_ATP_TO_UNIT to unit-2 with subset TP (TP3).
  const finding = analysis.atpFindings.find((f) => f.atpItemId === 'atp-1');
  assert.ok(finding, 'Finding for atp-1 must exist');
  assert.ok(finding?.action, 'Action recommending atp-1 to unit-2 must be present despite Z=0');
  assert.strictEqual(finding.action?.targetUnitId, 'unit-2');
  assert.ok(finding.action?.linkedTpIds.includes('TP3'), 'linkedTpIds should include TP3 relevant to pecahan');
  console.log('✅ Case B & C passed');
}

// ==========================================
// CASE D & G: Preserve existing Bab & Idempotent
// ==========================================
console.log('Testing Case D & G: Preserve existing Bab and Idempotency...');
{
  // If atp-1 is already in unit-2, sanitize should reject duplicate action
  const rawResult = {
    atpFindings: [
      {
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'ALIGNED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1', // already in unit-1
          linkedTpIds: ['TP1'],
        },
      },
    ],
    materialFindings: [],
  };

  const mapping: ATPUnitMappingData = {
    id: 'map-03',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1'],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sanitized = sanitizeMappingAnalysisResult(rawResult, {
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  const sanitizedFinding = sanitized.atpFindings[0];
  assert.strictEqual(sanitizedFinding.action, undefined, 'Sanitizer must drop ASSIGN_ATP_TO_UNIT if unit already has that ATP (idempotent)');
  console.log('✅ Case D & G passed');
}

// ==========================================
// CASE I: True Z=0 + Bab incomplete dead-lock prevention
// ==========================================
console.log('Testing Case I: True Z=0 deadlock prevention...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-i',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Bilangan',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1', 'TP2', 'TP3'],
        materials: [{ id: 'm-1', title: 'Operasi', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1', 'TP2'] }],
      },
      {
        id: 'unit-2',
        title: 'Bab 2: Pecahan',
        order: 2,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [{ id: 'm-2', title: 'Pecahan Sederhana', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const before = validateATPUnitMappingCanonical(mapping, mockATPData, mockTPData);
  assert.strictEqual(
    before.unmappedAtpIds.length + before.uncoveredTpIds.length,
    0,
    'Z=0 condition must be true'
  );
  assert.ok(
    before.unitsWithoutLineage.includes('unit-2'),
    'unit-2 must be incomplete'
  );

  const analysis = fallbackAnalyzeMapping({
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  const finding = analysis.atpFindings.find((f) => f.atpItemId === 'atp-1');
  assert.ok(finding?.action, 'Analyzer must recommend assignment to unit-2 despite Z=0');
  assert.strictEqual(finding.action?.targetUnitId, 'unit-2');
  assert.deepStrictEqual(
    finding.action?.linkedTpIds,
    ['TP3'],
    'Unit 2 must receive exactly TP3'
  );
  console.log('✅ Case I passed');
}

// ==========================================
// CASE J: Fail-Closed Invalid TP
// ==========================================
console.log('Testing Case J: Invalid TP rejected...');
{
  const rawResult = {
    atpFindings: [{
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'UNMAPPED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1',
          linkedTpIds: ['TP_INVALID'],
        },
    }],
    materialFindings: [],
  };
  const mapping: ATPUnitMappingData = {
    id: 'map-j',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [{ id: 'unit-1', title: 'Bab 1', order: 1, linkedAtpItemIds: [], linkedTpIds: [], materials: [] }],
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const sanitized = sanitizeMappingAnalysisResult(rawResult, { tpData: mockTPData, atpData: mockATPData, currentMapping: mapping });
  assert.strictEqual(sanitized.atpFindings[0].action, undefined);
  console.log('✅ Case J passed');
}

// ==========================================
// CASE K: Mixed Valid/Invalid TP
// ==========================================
console.log('Testing Case K: Mixed Valid/Invalid rejected...');
{
  const rawResult = {
    atpFindings: [{
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'UNMAPPED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1',
          linkedTpIds: ['TP1', 'TP_INVALID'],
        },
    }],
    materialFindings: [],
  };
  const mapping: ATPUnitMappingData = {
    id: 'map-k',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [{ id: 'unit-1', title: 'Bab 1', order: 1, linkedAtpItemIds: [], linkedTpIds: [], materials: [] }],
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const sanitized = sanitizeMappingAnalysisResult(rawResult, { tpData: mockTPData, atpData: mockATPData, currentMapping: mapping });
  assert.strictEqual(sanitized.atpFindings[0].action, undefined);
  console.log('✅ Case K passed');
}

// ==========================================
// CASE L: Regression Third Bab
// ==========================================
console.log('Testing Case L: Regression Third Bab...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-l',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      { id: 'unit-1', title: 'B1', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1'], materials: [] },
      { id: 'unit-2', title: 'B2', order: 2, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP2'], materials: [] },
      { id: 'unit-3', title: 'B3: Pecahan', order: 3, linkedAtpItemIds: [], linkedTpIds: [], materials: [{ id: 'm-3', title: 'Pecahan Sederhana', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }] },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const analysis = fallbackAnalyzeMapping({ tpData: mockTPData, atpData: mockATPData, currentMapping: mapping });
  const findings = analysis.atpFindings.filter(f => f.atpItemId === 'atp-1');
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].action?.targetUnitId, 'unit-3');
  console.log('✅ Case L passed');
}

// ==========================================
// CASE M: Material Closure
// ==========================================
console.log('Testing Case M: Material Closure...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-m',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      { id: 'unit-1', title: 'B1', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1', 'TP2'], materials: [{ id: 'm-supported', title: 'Bilangan', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1','TP2'] }] },
      { 
        id: 'unit-2', 
        title: 'B2', 
        order: 2, 
        linkedAtpItemIds: ['atp-1'], 
        linkedTpIds: ['TP3'], 
        materials: [{ id: 'm-2', title: 'Pecahan Sederhana', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }] 
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const analysis = fallbackAnalyzeMapping({ tpData: mockTPData, atpData: mockATPData, currentMapping: mapping });
  const matFinding = analysis.materialFindings.find(m => m.materialId === 'm-2');
  
  assert.ok(matFinding, 'Material finding m-2 must exist');
  console.log('Status found:', matFinding?.status);
  assert.strictEqual(
    matFinding?.status,
    'ALIGNABLE',
    'Material Pecahan Sederhana must be deterministically alignable'
  );
  assert.strictEqual(matFinding?.action?.type, 'ALIGN_EXISTING_MATERIAL');
  assert.deepStrictEqual(matFinding?.action?.linkedAtpItemIds, ['atp-1']);
  assert.deepStrictEqual(matFinding?.action?.linkedTpIds, ['TP3']);

  // Simulate applying
  mapping.units[1].materials[0].linkedAtpItemIds = ['atp-1'];
  mapping.units[1].materials[0].linkedTpIds = ['TP3'];

  const finalValidation = validateATPUnitMappingCanonical(mapping, mockATPData, mockTPData);
  
  assert.strictEqual(finalValidation.isValid, true);
  assert.strictEqual(finalValidation.isComplete, true);
  assert.deepStrictEqual(finalValidation.unitsWithoutLineage, []);
  assert.deepStrictEqual(finalValidation.materialsWithoutLineage, []);
  assert.deepStrictEqual(finalValidation.unmappedAtpIds, []);
  assert.deepStrictEqual(finalValidation.uncoveredTpIds, []);
  
  console.log('✅ Case M passed');
}

// ==========================================
// CASE N: Lock TP to ATP Canonical Parent
// ==========================================
console.log('Testing Case N: Reject TP belonging to another ATP...');
{
  const customATPData: ATPData = {
    ...mockATPData,
    items: [
      { id: 'atp-1', stepNumber: 1, linkedTpIds: ['TP1'], focus: 'Bilangan', jp: 4, semester: 1 },
      { id: 'atp-2', stepNumber: 2, linkedTpIds: ['TP2'], focus: 'Operasi', jp: 4, semester: 1 },
    ],
  };
  const rawResult = {
    atpFindings: [
      {
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'UNMAPPED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1',
          linkedTpIds: ['TP2'], // Belongs to atp-2, not atp-1
        },
      },
    ],
    materialFindings: [],
  };
  const mapping: ATPUnitMappingData = {
    id: 'map-n',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [{ id: 'unit-1', title: 'Bab 1', order: 1, linkedAtpItemIds: [], linkedTpIds: [], materials: [] }],
    updatedAt: '2026-01-01T00:00:00Z',
  };
  const sanitized = sanitizeMappingAnalysisResult(rawResult, {
    tpData: mockTPData,
    atpData: customATPData,
    currentMapping: mapping,
  });
  assert.strictEqual(sanitized.atpFindings[0].action, undefined, 'Action must be undefined when TP belongs to another ATP');
  console.log('✅ Case N passed');
}

// ==========================================
// CASE O: ALIGNED ATP with Valid Multi-Bab Action to Empty Unit Preserved
// ==========================================
console.log('Testing Case O: AI ALIGNED without material evidence stays REVIEW without automatic action...');
{
  const rawResult = {
    atpFindings: [
      {
        id: 'f-aligned-multibab',
        atpItemId: 'atp-1',
        status: 'ALIGNED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-2',
          linkedTpIds: ['TP3'],
        },
      },
    ],
    materialFindings: [],
  };

  const mapping: ATPUnitMappingData = {
    id: 'map-o',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1', 'TP2'],
        materials: [],
      },
      {
        id: 'unit-2',
        title: 'Bab 2',
        order: 2,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sanitized = sanitizeMappingAnalysisResult(rawResult, {
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  const findings = sanitized.atpFindings;
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].status, 'REVIEW');
  assert.strictEqual(findings[0].action, undefined, 'AI assignment without supporting material must not be offered');
  assert(sanitized.materialFindings.every(f => f.status === 'MANUAL_REVIEW' && !f.action));
  console.log('✅ Case O passed');
}

console.log('=== ALL MULTI-BAB ANALYSIS REGRESSION TESTS PASSED SUCCESSFULLY ===');

