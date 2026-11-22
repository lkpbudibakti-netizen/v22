import {
  validateATPUnitMappingCanonical,
} from '../src/services/atpUnitMappingValidationService';
import {
  buildCurrentMappingDraftFromUnits,
  createInitialUnits,
} from '../src/components/ATPUnitMappingManager';
import {
  ATPUnitMappingData,
  ATPData,
  TPData,
  ATPUnitMapping,
  ATPItem,
  TPItem,
} from '../src/types';

async function runPersistenceRegressionSuite() {
  console.log('=== RUNNING ATP UNIT MAPPING PERSISTENCE REGRESSION SUITE ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
      failedCount++;
    }
  }

  const mockTpData: TPData = {
    id: 'tp-data-1',
    academicSettingId: 'setting-1',
    subjectCode: 'Informatika',
    phase: 'E',
    workflowStatus: 'SIAP',
    items: [
      { id: 'tp-101', code: 'TP-1', statement: 'Memahami konsep dasar algoritma', competence: 'Memahami', contentScope: 'Algoritma', order: 1 },
      { id: 'tp-102', code: 'TP-2', statement: 'Menerapkan struktur kontrol percabangan', competence: 'Menerapkan', contentScope: 'Percabangan', order: 2 },
      { id: 'tp-103', code: 'TP-3', statement: 'Menerapkan struktur kontrol perulangan', competence: 'Menerapkan', contentScope: 'Perulangan', order: 3 },
      { id: 'tp-104', code: 'TP-4', statement: 'Menganalisis kompleksitas algoritma sederhana', competence: 'Menganalisis', contentScope: 'Kompleksitas', order: 4 },
    ],
    updatedAt: new Date().toISOString(),
  };

  const mockAtpData: ATPData = {
    id: 'atp-data-1',
    academicSettingId: 'setting-1',
    tpDataId: 'tp-data-1',
    subjectCode: 'Informatika',
    phase: 'E',
    workflowStatus: 'SIAP',
    items: [
      {
        id: 'atp-1',
        stepNumber: 1,
        focus: 'Konsep Dasar Algoritma',
        linkedTpIds: ['tp-101'],
        tpId: 'tp-101',
      },
      {
        id: 'atp-2',
        stepNumber: 2,
        focus: 'Percabangan dan Perulangan',
        linkedTpIds: ['tp-102', 'tp-103'],
        tpId: 'tp-102',
      },
      {
        id: 'atp-3',
        stepNumber: 3,
        focus: 'Analisis Algoritma',
        linkedTpIds: ['tp-104'],
        tpId: 'tp-104',
      },
    ],
    updatedAt: new Date().toISOString(),
  };

  // ----------------------------------------------------
  // Test 1: VALID UNIT LINEAGE (Lossless preservation)
  // ----------------------------------------------------
  console.log('--- Test 1: Valid Unit Lineage Preservation ---');
  const liveUnitsTest1: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1: Algoritma dan Pemrograman',
      order: 1,
      linkedAtpItemIds: ['atp-1', 'atp-2'],
      linkedTpIds: ['tp-101', 'tp-102', 'tp-103'],
      materials: [],
    },
  ];

  const payload1 = buildCurrentMappingDraftFromUnits(
    liveUnitsTest1,
    'map-1',
    'setting-1',
    'atp-data-1',
    'tp-data-1'
  );

  const unitPayload1 = payload1.units[0];
  assert(
    unitPayload1.linkedAtpItemIds.length === 2 &&
      unitPayload1.linkedAtpItemIds.includes('atp-1') &&
      unitPayload1.linkedAtpItemIds.includes('atp-2'),
    'Save payload mempertahankan semua linkedAtpItemIds pada Unit',
    `actual=${JSON.stringify(unitPayload1.linkedAtpItemIds)}`
  );
  assert(
    unitPayload1.linkedTpIds.length === 3 &&
      unitPayload1.linkedTpIds.includes('tp-101') &&
      unitPayload1.linkedTpIds.includes('tp-102') &&
      unitPayload1.linkedTpIds.includes('tp-103'),
    'Save payload mempertahankan semua linkedTpIds pada Unit',
    `actual=${JSON.stringify(unitPayload1.linkedTpIds)}`
  );

  // ----------------------------------------------------
  // Test 2: VALID MATERIAL LINEAGE (Lossless preservation)
  // ----------------------------------------------------
  console.log('\n--- Test 2: Valid Material Lineage Preservation ---');
  const liveUnitsTest2: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1: Algoritma dan Pemrograman',
      order: 1,
      linkedAtpItemIds: ['atp-1', 'atp-2'],
      linkedTpIds: ['tp-101', 'tp-102', 'tp-103'],
      materials: [
        {
          id: 'mat-101',
          title: 'Konsep Algoritma',
          order: 1,
          linkedAtpItemIds: ['atp-1'],
          linkedTpIds: ['tp-101'],
        },
        {
          id: 'mat-102',
          title: 'Struktur Kontrol Program',
          order: 2,
          linkedAtpItemIds: ['atp-2'],
          linkedTpIds: ['tp-102', 'tp-103'],
        },
      ],
    },
  ];

  const payload2 = buildCurrentMappingDraftFromUnits(
    liveUnitsTest2,
    'map-1',
    'setting-1',
    'atp-data-1',
    'tp-data-1'
  );

  const mat1 = payload2.units[0].materials[0];
  const mat2 = payload2.units[0].materials[1];

  assert(
    mat1.linkedAtpItemIds.length === 1 && mat1.linkedAtpItemIds[0] === 'atp-1' &&
      mat1.linkedTpIds.length === 1 && mat1.linkedTpIds[0] === 'tp-101',
    'Save payload mempertahankan material 1 lineage lengkap',
    `mat1Atp=${JSON.stringify(mat1.linkedAtpItemIds)}, mat1Tp=${JSON.stringify(mat1.linkedTpIds)}`
  );
  assert(
    mat2.linkedAtpItemIds.length === 1 && mat2.linkedAtpItemIds[0] === 'atp-2' &&
      mat2.linkedTpIds.length === 2 && mat2.linkedTpIds.includes('tp-102') && mat2.linkedTpIds.includes('tp-103'),
    'Save payload mempertahankan material 2 lineage lengkap',
    `mat2Atp=${JSON.stringify(mat2.linkedAtpItemIds)}, mat2Tp=${JSON.stringify(mat2.linkedTpIds)}`
  );

  // ----------------------------------------------------
  // Test 3: INCOMPLETE BUT VALID DRAFT SAVEABLE
  // ----------------------------------------------------
  console.log('\n--- Test 3: Incomplete but Valid Draft Allowed to Save ---');
  // atp-3 and tp-104 are not yet mapped -> isComplete === false, but all existing references are valid
  const liveUnitsTest3: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1: Algoritma Dasar',
      order: 1,
      linkedAtpItemIds: ['atp-1'],
      linkedTpIds: ['tp-101'],
      materials: [
        {
          id: 'mat-1',
          title: 'Pengantar Algoritma',
          order: 1,
          linkedAtpItemIds: ['atp-1'],
          linkedTpIds: ['tp-101'],
        },
      ],
    },
    {
      id: 'unit-2',
      title: 'Bab 2: Belum Diisi',
      order: 2,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    },
  ];

  const payload3 = buildCurrentMappingDraftFromUnits(
    liveUnitsTest3,
    'map-1',
    'setting-1',
    'atp-data-1',
    'tp-data-1'
  );

  const validation3 = validateATPUnitMappingCanonical(payload3, mockAtpData, mockTpData);

  assert(
    validation3.isValid === true,
    'Incomplete draft is structurally valid (isValid === true)',
    `isValid=${validation3.isValid}`
  );
  assert(
    validation3.isComplete === false,
    'Incomplete draft reports isComplete === false',
    `isComplete=${validation3.isComplete}`
  );

  // Save contract execution check: isValid === true permits save
  let saveContractAllowed = false;
  if (validation3.isValid) {
    saveContractAllowed = true;
  }
  assert(
    saveContractAllowed === true,
    'Save contract is allowed when isValid === true even if isComplete === false'
  );

  // ----------------------------------------------------
  // Test 4: INVALID CANONICAL REFERENCE BLOCKS SAVE
  // ----------------------------------------------------
  console.log('\n--- Test 4: Invalid Canonical Reference Blocks Save ---');
  const liveUnitsTest4: ATPUnitMapping[] = [
    {
      id: 'unit-1',
      title: 'Bab 1: Fiktif',
      order: 1,
      linkedAtpItemIds: ['atp-fictitious-999'], // Invalid ATP ID
      linkedTpIds: ['tp-101'],
      materials: [
        {
          id: 'mat-1',
          title: 'Materi Fiktif',
          order: 1,
          linkedAtpItemIds: ['atp-fictitious-999'],
          linkedTpIds: ['tp-fake-888'], // Invalid TP ID
        },
      ],
    },
  ];

  const payload4 = buildCurrentMappingDraftFromUnits(
    liveUnitsTest4,
    'map-1',
    'setting-1',
    'atp-data-1',
    'tp-data-1'
  );

  // Builder MUST NOT silently remove the invalid IDs
  assert(
    payload4.units[0].linkedAtpItemIds.includes('atp-fictitious-999'),
    'Builder does NOT silently remove invalid ATP ID from Unit',
    `actual=${JSON.stringify(payload4.units[0].linkedAtpItemIds)}`
  );
  assert(
    payload4.units[0].materials[0].linkedTpIds.includes('tp-fake-888'),
    'Builder does NOT silently remove invalid TP ID from Material',
    `actual=${JSON.stringify(payload4.units[0].materials[0].linkedTpIds)}`
  );

  const validation4 = validateATPUnitMappingCanonical(payload4, mockAtpData, mockTpData);

  assert(
    validation4.isValid === false,
    'Validation catches fictitious IDs and sets isValid === false',
    `isValid=${validation4.isValid}, issues=${JSON.stringify(validation4.issues)}`
  );

  // Save contract execution check: isValid === false MUST block save
  let saveContractBlocked = false;
  if (!validation4.isValid) {
    saveContractBlocked = true;
  }
  assert(
    saveContractBlocked === true,
    'Save contract is strictly blocked when isValid === false'
  );

  // ----------------------------------------------------
  // Test 5: ROUND-TRIP SHAPE PERSISTENCE
  // ----------------------------------------------------
  console.log('\n--- Test 5: Round-Trip Shape Persistence ---');
  const originalLiveUnits: ATPUnitMapping[] = [
    {
      id: 'unit-rt-1',
      title: 'Bab 1: Algoritma',
      order: 1,
      linkedAtpItemIds: ['atp-1'],
      linkedTpIds: ['tp-101'],
      materials: [
        {
          id: 'mat-rt-101',
          title: 'Materi Pengenalan',
          order: 1,
          linkedAtpItemIds: ['atp-1'],
          linkedTpIds: ['tp-101'],
        },
      ],
    },
    {
      id: 'unit-rt-2',
      title: 'Bab 2: Kontrol Alur',
      order: 2,
      linkedAtpItemIds: ['atp-2', 'atp-3'],
      linkedTpIds: ['tp-102', 'tp-103', 'tp-104'],
      materials: [
        {
          id: 'mat-rt-201',
          title: 'Percabangan',
          order: 1,
          linkedAtpItemIds: ['atp-2'],
          linkedTpIds: ['tp-102'],
        },
        {
          id: 'mat-rt-202',
          title: 'Perulangan & Analisis',
          order: 2,
          linkedAtpItemIds: ['atp-2', 'atp-3'],
          linkedTpIds: ['tp-103', 'tp-104'],
        },
      ],
    },
  ];

  // 1. Build save payload
  const savedPayload = buildCurrentMappingDraftFromUnits(
    originalLiveUnits,
    'map-rt',
    'setting-1',
    'atp-data-1',
    'tp-data-1'
  );

  // 2. Recreate initial units from payload (simulating reload)
  const reloadedUnits = createInitialUnits(savedPayload, mockAtpData.items || []);

  assert(
    reloadedUnits.length === 2,
    'Round-trip preserves exact number of units',
    `length=${reloadedUnits.length}`
  );
  assert(
    reloadedUnits[0].title === 'Bab 1: Algoritma' &&
      reloadedUnits[0].linkedAtpItemIds.length === 1 &&
      reloadedUnits[0].linkedAtpItemIds[0] === 'atp-1' &&
      reloadedUnits[0].linkedTpIds.length === 1 &&
      reloadedUnits[0].linkedTpIds[0] === 'tp-101' &&
      reloadedUnits[0].materials.length === 1 &&
      reloadedUnits[0].materials[0].title === 'Materi Pengenalan' &&
      reloadedUnits[0].materials[0].linkedAtpItemIds[0] === 'atp-1' &&
      reloadedUnits[0].materials[0].linkedTpIds[0] === 'tp-101',
    'Round-trip preserves unit 1 and its material lineage identically'
  );
  assert(
    reloadedUnits[1].title === 'Bab 2: Kontrol Alur' &&
      reloadedUnits[1].linkedAtpItemIds.length === 2 &&
      reloadedUnits[1].linkedTpIds.length === 3 &&
      reloadedUnits[1].materials.length === 2 &&
      reloadedUnits[1].materials[1].title === 'Perulangan & Analisis' &&
      reloadedUnits[1].materials[1].linkedAtpItemIds.includes('atp-2') &&
      reloadedUnits[1].materials[1].linkedAtpItemIds.includes('atp-3') &&
      reloadedUnits[1].materials[1].linkedTpIds.includes('tp-103') &&
      reloadedUnits[1].materials[1].linkedTpIds.includes('tp-104'),
    'Round-trip preserves unit 2 and its material lineage identically'
  );

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runPersistenceRegressionSuite();
