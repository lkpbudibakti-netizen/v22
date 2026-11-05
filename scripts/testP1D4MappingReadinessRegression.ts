import { resolveATPUnitMappingReadiness } from '../src/services/atpMappingReadinessService';
import {
  computeAtpSubstantiveFingerprint,
  computeTpSubstantiveFingerprint,
} from '../src/services/atpMappingActionApplyService';
import { ATPUnitMappingData, ATPData, TPData, AcademicSetting } from '../src/types';

function assert(condition: boolean, message: string, details?: any) {
  if (!condition) {
    console.error('FAIL details:', details);
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log('Running P1-D4 Mapping Readiness Gate Regression Tests...');

const mockSetting: AcademicSetting = {
  profileId: 'profile-1', curriculum: 'Kurikulum Merdeka', phase: 'D', updatedAt: '2025-01-01T00:00:00Z',
  id: 'setting-1',
  academicYear: '2025/2026',
  semester: '1 (Ganjil)',
  level: 'SMP',
  grade: 'Kelas 7',
  subject: 'Matematika',
};

const mockTP: TPData = {
  id: 'tp-1',
  academicSettingId: 'setting-1',
  workflowStatus: 'SIAP',
  items: [
    {order: 1,
      id: 'tp-item-1',
      code: 'E1-MAT-01',
      statement: 'Memahami bilangan bulat',
      competence: 'Memahami',
      contentScope: 'Bilangan Bulat',
    }
  ],
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockATP: ATPData = {
  id: 'atp-1',
  academicSettingId: 'setting-1',
  workflowStatus: 'SIAP',
  tpId: 'tp-1',
  basedOnTpUpdatedAt: '2025-01-01T00:00:00Z',
  items: [
    { id: 'atp-item-1', stepNumber: 1, focus: 'Bilangan Bulat', linkedTpIds: ['tp-item-1'] }
  ],
  updatedAt: '2025-01-01T00:00:00Z',
};

const validMapping: ATPUnitMappingData = {atpId: 'atp-1',
  id: 'map-1',
  academicSettingId: 'setting-1',
  basedOnAtpUpdatedAt: '2025-01-01T00:00:00Z',
  basedOnTpUpdatedAt: '2025-01-01T00:00:00Z',
  units: [
    {order: 2,
      id: 'unit-1',
      title: 'Bab 1 Bilangan',
      linkedAtpItemIds: ['atp-item-1'],
      linkedTpIds: ['tp-item-1'],
      materials: [
        {order: 3,
          id: 'mat-1',
          title: 'Materi Bilangan Bulat',
          linkedAtpItemIds: ['atp-item-1'],
          linkedTpIds: ['tp-item-1'],
        }
      ]
    }
  ],
  updatedAt: '2025-01-01T00:00:00Z',
};

// 1. Mapping kosong -> canProceed=false
{
  const mapping: ATPUnitMappingData = {atpId: 'atp-1', updatedAt: '2025-01-01T00:00:00Z', id: 'm1', academicSettingId: 'setting-1', units: [] };
  const res = resolveATPUnitMappingReadiness(mapping, mockATP, mockTP, mockSetting);
  assert(res.canProceed === false, 'Mapping kosong cannot proceed');
}

// 2. ATP kosong -> canProceed=false
{
  const atp: ATPData = { ...mockATP, items: [] };
  const res = resolveATPUnitMappingReadiness(validMapping, atp, mockTP, mockSetting);
  assert(res.canProceed === false, 'ATP kosong cannot proceed');
}

// 3. TP kosong -> canProceed=false
{
  const tp: TPData = { ...mockTP, items: [] };
  const res = resolveATPUnitMappingReadiness(validMapping, mockATP, tp, mockSetting);
  assert(res.canProceed === false, 'TP kosong cannot proceed');
}

// 4. Mapping valid belum lengkap -> canSaveDraft=true, canProceed=false
{
  const mapping: ATPUnitMappingData = { ...validMapping, units: [{order: 4, id: 'u1', title: 'Bab 1', linkedAtpItemIds: [], linkedTpIds: [], materials: [] }] };
  const res = resolveATPUnitMappingReadiness(mapping, mockATP, mockTP, mockSetting);
  assert(res.canSaveDraft === true, 'Incomplete valid mapping can save draft');
  assert(res.canProceed === false, 'Incomplete mapping cannot proceed');
}

// 5. Mapping lengkap + upstream SIAP -> canProceed=true
{
  const res = resolveATPUnitMappingReadiness(validMapping, mockATP, mockTP, mockSetting);
  assert(res.canProceed === true, 'Mapping lengkap SIAP can proceed');
}

// 6. ATP DRAFT -> blokir
{
  const atp: ATPData = { ...mockATP, workflowStatus: 'DRAFT' };
  const res = resolveATPUnitMappingReadiness(validMapping, atp, mockTP, mockSetting);
  assert(res.canProceed === false, 'ATP DRAFT blocks proceed');
}

// 7. TP DRAFT -> blokir
{
  const tp: TPData = { ...mockTP, workflowStatus: 'DRAFT' };
  const res = resolveATPUnitMappingReadiness(validMapping, mockATP, tp, mockSetting);
  assert(res.canProceed === false, 'TP DRAFT blocks proceed');
}

// 8. Relasi ATP–TP salah -> blokir
{
  const atp: ATPData = { ...mockATP, tpId: 'other-tp' };
  const res = resolveATPUnitMappingReadiness(validMapping, atp, mockTP, mockSetting);
  assert(res.canProceed === false, 'Wrong ATP-TP relation blocks proceed');
  assert(res.blockers.some(b => /relasi\s+ATP[\s–-]*TP/i.test(b)), 'Blocker mentions relation');
}

// 9. Academic setting berbeda -> blokir
{
  const setting: AcademicSetting = { ...mockSetting, id: 'wrong-setting' };
  const res = resolveATPUnitMappingReadiness(validMapping, mockATP, mockTP, setting);
  assert(res.canProceed === false, 'Different academic setting blocks proceed');
}

// 10. Referensi ATP/TP fiktif -> canSaveDraft=false
{
  const mapping: ATPUnitMappingData = { ...validMapping, units: [{order: 5, id: 'u1', title: 'Bab 1', linkedAtpItemIds: ['fictional-atp'], linkedTpIds: ['fictional-tp'], materials: [] }] };
  const res = resolveATPUnitMappingReadiness(mapping, mockATP, mockTP, mockSetting);
  assert(res.canSaveDraft === false, 'Fictional reference blocks save draft');
}

// 11. Mapping baru dengan fingerprint: metadata-only upstream tidak stale
{
  const atp: ATPData = { ...mockATP, updatedAt: '2025-01-02T00:00:00Z' };
  const mapping: ATPUnitMappingData = {
    ...validMapping,
    basedOnAtpFingerprint: computeAtpSubstantiveFingerprint(mockATP),
    basedOnTpFingerprint: computeTpSubstantiveFingerprint(mockTP),
  };
  const res = resolveATPUnitMappingReadiness(mapping, atp, mockTP, mockSetting);
  assert(res.canProceed === true, 'Metadata change alone should not trigger stale');
}

// 12. Mapping baru dengan fingerprint: perubahan substansi upstream -> blokir
{
  const atp: ATPData = { ...mockATP, updatedAt: '2025-01-03T00:00:00Z', items: [{...mockATP.items[0], focus: 'Updated Focus'}] };
  const mapping: ATPUnitMappingData = {
    ...validMapping,
    basedOnAtpFingerprint: computeAtpSubstantiveFingerprint(mockATP),
    basedOnTpFingerprint: computeTpSubstantiveFingerprint(mockTP),
  };
  const res = resolveATPUnitMappingReadiness(mapping, atp, mockTP, mockSetting);
  assert(res.canProceed === false, 'Stale upstream blocks proceed');
}

// 12b. Mapping lama tanpa fingerprint tetap konservatif bila timestamp upstream lebih baru
{
  const atp: ATPData = { ...mockATP, updatedAt: '2025-01-02T00:00:00Z' };
  const res = resolveATPUnitMappingReadiness(validMapping, atp, mockTP, mockSetting);
  assert(res.canProceed === false, 'Legacy mapping without substantive fingerprint must not bypass stale guard');
  assert(res.blockers.some(b => b.includes('stale')), 'Legacy stale blocker must be explicit');
}

// 13. Keputusan resolver berdasarkan konteks data realistis
{
  const savedMapping: ATPUnitMappingData = { ...validMapping, units: validMapping.units };
  const draftMapping: ATPUnitMappingData = { ...validMapping, units: [...validMapping.units, {order: 6,id: 'new-u', title: 'New', linkedAtpItemIds: [], linkedTpIds: [], materials: []}] };
  
  const resSaved = resolveATPUnitMappingReadiness(savedMapping, mockATP, mockTP, mockSetting);
  const resDraft = resolveATPUnitMappingReadiness(draftMapping, mockATP, mockTP, mockSetting);
  
  assert(resSaved.canProceed === true, 'Saved mapping is valid');
  assert(resDraft.canProceed === false, 'Draft mapping with empty new unit is not ready');
}

// 14. Mapping multi-Bab valid -> tetap dapat lanjut
{
  const mapping: ATPUnitMappingData = { 
    ...validMapping, 
    units: [
      validMapping.units[0],
      {order: 7, id: 'u2', title: 'Bab 2', linkedAtpItemIds: ['atp-item-1'], linkedTpIds: ['tp-item-1'], materials: [] }
    ] 
  };
  const res = resolveATPUnitMappingReadiness(mapping, mockATP, mockTP, mockSetting);
  assert(res.canSaveDraft === true, 'Multi-Bab with missing material coverage remains saveable as draft');
  assert(res.canProceed === false, 'Bab without material support cannot proceed');
  assert(res.blockers.some(b => b.includes('SOURCE_LINEAGE_MISSING')), 'Missing material support is explicit');
  mapping.units[1].materials = [{ ...validMapping.units[0].materials[0], id: 'mat-2' }];
  assert(resolveATPUnitMappingReadiness(mapping, mockATP, mockTP, mockSetting).canProceed === true,
    'Multi-Bab with complete material lineage can proceed');
}

// 15. Validasi summary/blockers konsisten
{
  const atp: ATPData = { ...mockATP, workflowStatus: 'DRAFT' };
  const res = resolveATPUnitMappingReadiness(validMapping, atp, mockTP, mockSetting);
  assert(res.blockers.length > 0 && res.blockers.some(b => b.includes('ATP')), 'Blocker summary consistent for ATP DRAFT');
}

console.log('All 16 P1-D4 Mapping Readiness Gate Regression Tests passed successfully!');
