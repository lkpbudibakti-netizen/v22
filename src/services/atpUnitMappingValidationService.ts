import { ATPUnitMappingData, ATPData, TPData, ATPUnitMapping, ATPUnitMaterial } from '../types';

export interface ATPUnitMappingValidationResult {
  isValid: boolean;
  isComplete: boolean;
  issues: string[];

  unitsWithoutLineage: string[];
  materialsWithoutLineage: Array<{
    unitId: string;
    materialId: string;
  }>;

  invalidReferenceCount: number;
  unmappedAtpIds: string[];
  uncoveredTpIds: string[];
  materialCoverageGaps: Array<{ unitId: string; unitTitle: string; tpIds: string[]; atpItemIds: string[] }>;
}

function getCanonicalTpsForAtpItem(atpItem: any): string[] {
  if (!atpItem) return [];
  if (Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0) {
    return atpItem.linkedTpIds;
  }
  if (atpItem.tpId) {
    return [atpItem.tpId];
  }
  return [];
}

export function validateATPUnitMappingCanonical(
  mapping: ATPUnitMappingData | undefined,
  atp: ATPData | undefined,
  tp: TPData | undefined
): ATPUnitMappingValidationResult {
  const result: ATPUnitMappingValidationResult = {
    isValid: true,
    isComplete: true,
    issues: [],
    unitsWithoutLineage: [],
    materialsWithoutLineage: [],
    invalidReferenceCount: 0,
    unmappedAtpIds: [],
    uncoveredTpIds: [],
    materialCoverageGaps: [],
  };

  if (!mapping || !atp || !tp) {
    result.isValid = false;
    result.isComplete = false;
    result.issues.push('Data pemetaan, ATP, atau TP tidak tersedia.');
    result.invalidReferenceCount = 1;
    return result;
  }

  const validAtpIds = new Set((atp.items || []).map((item) => item.id));
  const validTpIds = new Set((tp.items || []).map((item) => item.id));

  const atpMap = new Map<string, any>();
  (atp.items || []).forEach((item) => {
    atpMap.set(item.id, item);
  });

  const unitIdsSeen = new Set<string>();
  const materialIdsSeen = new Set<string>();

  const units = mapping.units || [];

  // Bab presentation order is independent of ATP stepNumber. Only a wholly
  // reversed pair of pedagogical spans is forbidden; revisits/overlaps are valid.
  const spans = (atp.items || []).map(item => {
    const orders = units.filter(unit => unit.linkedAtpItemIds?.includes(item.id) &&
      unit.linkedTpIds?.some(id => getCanonicalTpsForAtpItem(item).includes(id))).map(unit => unit.order);
    return { item, min: Math.min(...orders), max: Math.max(...orders), present: orders.length > 0 };
  });
  for (const early of spans) for (const late of spans) {
    if (early.present && late.present && early.item.stepNumber < late.item.stepNumber && late.max < early.min) {
      result.isValid = false;
      result.issues.push(`ATP_PROGRESSION_REVERSED: ATP tahap ${late.item.stepNumber} ('${late.item.id}') seluruhnya sebelum tahap ${early.item.stepNumber} ('${early.item.id}'). Urutan Bab tidak perlu sama dengan nomor ATP; pertahankan progresi atau overlap pedagogis yang sah.`);
    }
  }

  // Check structure and duplicates
  for (const u of units) {
    if (!u.id) {
      result.isValid = false;
      result.isComplete = false;
      result.invalidReferenceCount++;
      result.issues.push('Ditemukan Bab tanpa ID yang valid.');
      continue;
    }
    if (unitIdsSeen.has(u.id)) {
      result.isValid = false;
      result.isComplete = false;
      result.invalidReferenceCount++;
      result.issues.push(`ID Bab ganda terdeteksi: ${u.id}`);
    }
    unitIdsSeen.add(u.id);

    for (const m of u.materials || []) {
      if (!m.id) {
        result.isValid = false;
        result.isComplete = false;
        result.invalidReferenceCount++;
        result.issues.push(`Ditemukan Lingkup Materi tanpa ID pada Bab '${u.title || u.id}'.`);
        continue;
      }
      if (materialIdsSeen.has(m.id)) {
        result.isValid = false;
        result.isComplete = false;
        result.invalidReferenceCount++;
        result.issues.push(`ID Lingkup Materi ganda terdeteksi: ${m.id}`);
      }
      materialIdsSeen.add(m.id);
    }
  }

  // Validate Units and Materials
  for (const u of units) {
    const unitAtpIds = u.linkedAtpItemIds || [];
    const unitTpIds = u.linkedTpIds || [];
    let unitHasLineage = true;

    // Check non-empty title
    if (!u.title || u.title.trim().length === 0) {
      unitHasLineage = false;
      result.issues.push(`Judul Bab dengan ID '${u.id}' kosong.`);
    }

    // Check non-empty lineage
    if (unitAtpIds.length === 0 || unitTpIds.length === 0) {
      unitHasLineage = false;
      result.issues.push(`Silsilah (lineage) Bab '${u.title || u.id}' kosong.`);
    }

    // Check existence of referenced IDs in canonical
    for (const atpId of unitAtpIds) {
      if (!validAtpIds.has(atpId)) {
        result.isValid = false;
        result.isComplete = false;
        result.invalidReferenceCount++;
        result.issues.push(`Bab '${u.title || u.id}' merujuk ID ATP canonical fiktif: ${atpId}`);
      }
    }

    for (const tpId of unitTpIds) {
      if (!validTpIds.has(tpId)) {
        result.isValid = false;
        result.isComplete = false;
        result.invalidReferenceCount++;
        result.issues.push(`Bab '${u.title || u.id}' merujuk ID TP canonical fiktif: ${tpId}`);
      }
    }

    // Every Unit TP supported by >=1 Unit ATP
    for (const atpId of unitAtpIds) {
      if (validAtpIds.has(atpId) && !unitTpIds.some(id => getCanonicalTpsForAtpItem(atpMap.get(atpId)).includes(id))) {
        result.isValid = false;
        result.issues.push(`Bab '${u.title || u.id}': ATP '${atpId}' tidak memiliki subset TP canonical pendukung.`);
      }
    }
    for (const tpId of unitTpIds) {
      if (!validTpIds.has(tpId)) continue;
      let supported = false;
      for (const atpId of unitAtpIds) {
        if (!validAtpIds.has(atpId)) continue;
        const atpItem = atpMap.get(atpId);
        const canonTps = getCanonicalTpsForAtpItem(atpItem);
        if (canonTps.includes(tpId)) {
          supported = true;
          break;
        }
      }
      if (!supported) {
        unitHasLineage = false;
        result.isValid = false;
        result.invalidReferenceCount++;
        result.issues.push(`TP '${tpId}' pada Bab '${u.title || u.id}' tidak didukung oleh langkah ATP mana pun di Bab tersebut.`);
      }
    }

    if (!unitHasLineage) {
      result.isComplete = false;
      result.unitsWithoutLineage.push(u.id);
    }

    // Validate Materials
    for (const m of u.materials || []) {
      const matAtpIds = m.linkedAtpItemIds || [];
      const matTpIds = m.linkedTpIds || [];
      let matHasLineage = true;

      if (!m.title || m.title.trim().length === 0) {
        matHasLineage = false;
        result.issues.push(`Judul Lingkup Materi dengan ID '${m.id}' di Bab '${u.title || u.id}' kosong.`);
      }

      if (matAtpIds.length === 0 || matTpIds.length === 0) {
        matHasLineage = false;
        result.issues.push(`Silsilah (lineage) Lingkup Materi '${m.title || m.id}' di Bab '${u.title || u.id}' kosong.`);
      }

      // Material ATP subset of Unit ATP
      const parentUnitAtpSet = new Set(unitAtpIds);
      for (const atpId of matAtpIds) {
        if (!parentUnitAtpSet.has(atpId)) {
          result.isValid = false;
          result.isComplete = false;
          result.invalidReferenceCount++;
          result.issues.push(`Lingkup Materi '${m.title || m.id}' merujuk ATP '${atpId}' yang tidak ada pada Bab induk '${u.title || u.id}'.`);
        }
      }

      // Material TP subset of Unit TP
      const parentUnitTpSet = new Set(unitTpIds);
      for (const tpId of matTpIds) {
        if (!parentUnitTpSet.has(tpId)) {
          result.isValid = false;
          result.isComplete = false;
          result.invalidReferenceCount++;
          result.issues.push(`Lingkup Materi '${m.title || m.id}' merujuk TP '${tpId}' yang tidak ada pada Bab induk '${u.title || u.id}'.`);
        }
      }

      // Every Material TP supported by >=1 Material ATP
      for (const atpId of matAtpIds) {
        if (validAtpIds.has(atpId) && !matTpIds.some(id => getCanonicalTpsForAtpItem(atpMap.get(atpId)).includes(id))) {
          result.isValid = false;
          result.issues.push(`Lingkup Materi '${m.title || m.id}': ATP '${atpId}' tidak memiliki TP canonical pendukung.`);
        }
      }
      for (const tpId of matTpIds) {
        if (!validTpIds.has(tpId) || !parentUnitTpSet.has(tpId)) continue;
        let supported = false;
        for (const atpId of matAtpIds) {
          if (!validAtpIds.has(atpId) || !parentUnitAtpSet.has(atpId)) continue;
          const atpItem = atpMap.get(atpId);
          const canonTps = getCanonicalTpsForAtpItem(atpItem);
          if (canonTps.includes(tpId)) {
            supported = true;
            break;
          }
        }
        if (!supported) {
          matHasLineage = false;
          result.isValid = false;
          result.invalidReferenceCount++;
          result.issues.push(`TP '${tpId}' pada Lingkup Materi '${m.title || m.id}' tidak didukung oleh langkah ATP mana pun di materi tersebut.`);
        }
      }

      if (!matHasLineage) {
        result.isComplete = false;
        result.materialsWithoutLineage.push({
          unitId: u.id,
          materialId: m.id,
        });
      }
    }
  }

  // A Bab is ready only when its material lineage can support Step 08 meetings.
  for (const unit of units) {
    const materialTpIds = new Set((unit.materials || []).flatMap(m => m.linkedTpIds || []));
    const materialAtpIds = new Set((unit.materials || []).flatMap(m => m.linkedAtpItemIds || []));
    const tpIds = (unit.linkedTpIds || []).filter(id => !materialTpIds.has(id));
    const atpItemIds = (unit.linkedAtpItemIds || []).filter(id => !materialAtpIds.has(id));
    if (tpIds.length || atpItemIds.length) {
      result.isComplete = false;
      result.materialCoverageGaps.push({ unitId: unit.id, unitTitle: unit.title, tpIds, atpItemIds });
      result.issues.push(`SOURCE_LINEAGE_MISSING: Bab '${unit.title || unit.id}' (${unit.id}): gabungan Lingkup Materi belum mencakup TP [${tpIds.join(', ')}] dan ATP [${atpItemIds.join(', ')}]. Selaraskan materi yang relevan sebelum lanjut Step 08.`);
    }
  }

  // Validate Global Rules
  // 1. Every canonical ATP appears in >=1 Unit
  const assignedAtpSet = new Set<string>();
  for (const u of units) {
    for (const atpId of u.linkedAtpItemIds || []) {
      if (validAtpIds.has(atpId)) {
        assignedAtpSet.add(atpId);
      }
    }
  }

  for (const atpItem of atp.items || []) {
    if (!assignedAtpSet.has(atpItem.id)) {
      result.isComplete = false;
      result.unmappedAtpIds.push(atpItem.id);
      result.issues.push(`Langkah ATP canonical '${atpItem.focus || atpItem.id}' belum dipetakan ke Bab mana pun.`);
    }
  }

  // 2. For every ATP: union of Unit TPs across Units containing ATP covers all canonical TPs of that ATP
  for (const atpItem of atp.items || []) {
    const canonTps = getCanonicalTpsForAtpItem(atpItem);
    const unitsContainingAtp = units.filter((u) => (u.linkedAtpItemIds || []).includes(atpItem.id));

    const unionUnitTps = new Set<string>();
    for (const u of unitsContainingAtp) {
      for (const tpId of u.linkedTpIds || []) {
        unionUnitTps.add(tpId);
      }
    }

    const missingTpsForAtp: string[] = [];
    for (const canonTpId of canonTps) {
      if (!unionUnitTps.has(canonTpId)) {
        missingTpsForAtp.push(canonTpId);
        result.isComplete = false;
        if (!result.uncoveredTpIds.includes(canonTpId)) {
          result.uncoveredTpIds.push(canonTpId);
        }
      }
    }

    if (missingTpsForAtp.length > 0) {
      result.issues.push(`Langkah ATP '${atpItem.focus || atpItem.id}' dipetakan ke Bab [${unitsContainingAtp.map((u) => u.title || u.id).join(', ')}], tetapi TP canonical [${missingTpsForAtp.join(', ')}] dari ATP ini belum dicakup oleh Bab-bab tersebut.`);
    }
  }

  // If there are any validation errors (isValid false), it can't be complete.
  for (const tpItem of tp.items || []) {
    if (!units.some(unit => unit.linkedTpIds?.includes(tpItem.id)) && !result.uncoveredTpIds.includes(tpItem.id)) {
      result.uncoveredTpIds.push(tpItem.id);
      result.isComplete = false;
      result.issues.push(`TP canonical '${tpItem.id}' belum tercakup pada Bab mana pun.`);
    }
  }
  if (!result.isValid) {
    result.isComplete = false;
  }

  return result;
}
