interface Meeting { title: string; materialIds: string[] }
interface Suggestion { unitId: string; meetings: Meeting[] }
interface Unit {
  id: string; title: string; linkedTpIds: string[]; linkedAtpItemIds: string[];
  materials: { id: string; title: string; linkedTpIds: string[]; linkedAtpItemIds: string[] }[];
}

export class MeetingCoverageError extends Error {
  constructor(
    public code: 'SOURCE_LINEAGE_MISSING' | 'AI_COVERAGE_MISSING' | 'AI_REPAIR_FAILED',
    message: string,
    public diagnostic: Record<string, unknown>,
  ) { super(message); }
}

export function assertMeetingSourceLineage(units: Unit[], tpItems?: { id: string }[],
  atpItems?: { id: string; linkedTpIds?: string[]; tpId?: string }[]) {
  const tpMap = tpItems && new Set(tpItems.map(t => t.id));
  const atpMap = atpItems && new Map(atpItems.map(a => [a.id, a]));
  const issues = units.flatMap(unit => {
    const materialIssues = unit.materials.flatMap(mat => {
      const tpIds = mat.linkedTpIds || [];
      const atpIds = mat.linkedAtpItemIds || [];
      const invalidTpIds = tpIds.filter(id => !unit.linkedTpIds.includes(id) || (tpMap && !tpMap.has(id)) ||
        (atpMap && !atpIds.some(aid => {
          const atp = atpMap.get(aid);
          return (atp?.linkedTpIds?.length ? atp.linkedTpIds : [atp?.tpId]).includes(id);
        })));
      const invalidAtpIds = atpIds.filter(id => !unit.linkedAtpItemIds.includes(id) || (atpMap && !atpMap.has(id)));
      return !tpIds.length || !atpIds.length || invalidTpIds.length || invalidAtpIds.length
        ? [{ materialId: mat.id, materialTitle: mat.title, tpIds: invalidTpIds, atpItemIds: invalidAtpIds,
          reason: !tpIds.length || !atpIds.length ? 'Lineage TP/ATP materi kosong.' : 'Lineage materi tidak didukung Bab/ATP/TP canonical.' }] : [];
    });
    const validMaterials = unit.materials.filter(m => !materialIssues.some(issue => issue.materialId === m.id));
    const tpIds = unit.linkedTpIds.filter(id => (tpMap && !tpMap.has(id)) || !validMaterials.some(m => m.linkedTpIds.includes(id)));
    const atpItemIds = unit.linkedAtpItemIds.filter(id => (atpMap && !atpMap.has(id)) || !validMaterials.some(m => m.linkedAtpItemIds.includes(id)));
    return tpIds.length || atpItemIds.length || materialIssues.length || !unit.linkedTpIds.length || !unit.linkedAtpItemIds.length
      ? [{ unitId: unit.id, unitTitle: unit.title, tpIds, atpItemIds, materialIssues,
        materialIds: materialIssues.map(m => m.materialId),
        reason: 'Seluruh TP/ATP Bab wajib didukung lineage materi canonical yang valid.' }] : [];
  });
  if (issues.length) throw new MeetingCoverageError('SOURCE_LINEAGE_MISSING',
    issues.map(i => `Bab "${i.unitTitle}" (${i.unitId}): TP [${i.tpIds}], ATP [${i.atpItemIds}], materi bermasalah [${i.materialIds}]. ${i.reason}`).join('; '),
    { stage: 'SOURCE_PREFLIGHT', sourceIssues: issues });
}

export function inspectMeetingCoverage(units: Unit[], suggestions: Suggestion[], existing: any[] = []) {
  return units.flatMap(unit => {
    const meetings = [...(existing.find(u => u.unitId === unit.id)?.meetings || []),
      ...(suggestions.find(u => u.unitId === unit.id)?.meetings || [])];
    const materials = new Set<string>(meetings.flatMap(m => m.materialIds || []));
    const selected = unit.materials.filter(m => materials.has(m.id));
    const tps = new Set(selected.flatMap(m => m.linkedTpIds || []));
    const atps = new Set(selected.flatMap(m => m.linkedAtpItemIds || []));
    const missing = {
      unitId: unit.id, unitTitle: unit.title,
      materialIds: unit.materials.filter(m => !materials.has(m.id)).map(m => m.id),
      tpIds: unit.linkedTpIds.filter(id => !tps.has(id)),
      atpItemIds: unit.linkedAtpItemIds.filter(id => !atps.has(id)),
    };
    return missing.materialIds.length || missing.tpIds.length || missing.atpItemIds.length ? [missing] : [];
  });
}

// Repairs only generated slots; existing teacher meetings never enter the replacement payload.
export async function repairUnitMeetingCoverage(input: {
  units: Unit[]; suggestions: Suggestion[]; existing?: any[];
  expectedCounts?: Map<string, number>;
  semesterByUnit?: Map<string, number>;
  repair?: (payload: unknown) => Promise<{ units: Suggestion[] }>;
}) {
  assertMeetingSourceLineage(input.units);
  const initialDiagnostic = {
    generatedCount: input.suggestions.reduce((sum, u) => sum + (Array.isArray(u?.meetings) ? u.meetings.length : 0), 0),
    semesterCounts: [1, 2].map(semester => ({ semester,
      generatedCount: input.suggestions.filter(u => input.semesterByUnit?.get(u.unitId) === semester)
        .reduce((sum, u) => sum + (Array.isArray(u?.meetings) ? u.meetings.length : 0), 0) })),
    perUnit: input.suggestions.map(u => ({ unitId: u.unitId, generatedCount: u.meetings?.length || 0,
      expectedCount: input.expectedCounts?.get(u.unitId) })),
  };
  const invalidInitial = (reason: string): never => {
    throw new MeetingCoverageError('AI_COVERAGE_MISSING', reason, { stage: 'AI_COVERAGE', initialAI: initialDiagnostic });
  };
  const seen = new Set<string>();
  for (const suggestion of input.suggestions) {
    const unit = input.units.find(u => u.id === suggestion?.unitId);
    if (!unit || seen.has(suggestion.unitId) || !Array.isArray(suggestion.meetings)) {
      invalidInitial('Struktur/identitas Bab AI invalid; repair cakupan tidak boleh mengubahnya.');
    }
    seen.add(suggestion.unitId);
    for (const meeting of suggestion.meetings) {
      if (!meeting || typeof meeting.title !== 'string' || !meeting.title.trim() ||
          !Array.isArray(meeting.materialIds) || !meeting.materialIds.length ||
          new Set(meeting.materialIds).size !== meeting.materialIds.length ||
          meeting.materialIds.some(id => !unit!.materials.some(m => m.id === id))) {
        invalidInitial(`Bab "${unit!.title}": judul atau referensi materi hasil awal AI invalid.`);
      }
    }
    if (input.expectedCounts && suggestion.meetings.length !== input.expectedCounts.get(suggestion.unitId)) {
      invalidInitial(`Bab "${unit.title}": jumlah slot awal tidak sesuai target exact.`);
    }
  }
  if (input.expectedCounts && input.units.some(u =>
    (input.expectedCounts!.get(u.id) || 0) > 0 && !seen.has(u.id))) {
    invalidInitial('Bab dengan target pertemuan tidak dikembalikan AI.');
  }
  const missing = inspectMeetingCoverage(input.units, input.suggestions, input.existing);
  if (!missing.length) return input.suggestions;
  const describe = () => missing.map(m => `Bab "${m.unitTitle}" (${m.unitId}): TP [${m.tpIds.join(', ')}], ATP [${m.atpItemIds.join(', ')}], materi [${m.materialIds.join(', ')}]`).join('; ');
  const diagnostic = { stage: 'AI_COVERAGE', initialAI: { ...initialDiagnostic, missingCoverage: missing } };
  const fail = (reason: string): never => {
    throw new MeetingCoverageError('AI_REPAIR_FAILED', `${describe()}. ${reason}`, { ...diagnostic, repairFailure: reason });
  };
  if (!input.repair) throw new MeetingCoverageError('AI_COVERAGE_MISSING', describe(), diagnostic);
  const ids = new Set(missing.map(m => m.unitId));
  const targets = input.suggestions.filter(u => ids.has(u.unitId));
  for (const m of missing) {
    if (!targets.some(u => u.unitId === m.unitId && u.meetings.length)) fail('Tidak ada slot AI yang dapat diperbaiki.');
  }
  let response: { units: Suggestion[] };
  try {
    response = await input.repair({ missing, canonicalUnits: input.units.filter(u => ids.has(u.id)), generatedUnits: targets });
  } catch (error) { return fail(`Repair AI gagal: ${error instanceof Error ? error.message : String(error)}`); }
  if (!Array.isArray(response?.units) || response.units.length !== targets.length ||
      response.units.some(u => !u || typeof u.unitId !== 'string') ||
      new Set(response.units.map(u => u.unitId)).size !== targets.length) fail('Repair mengubah daftar Bab.');
  for (const u of response.units) {
    const original = targets.find(t => t.unitId === u.unitId);
    const canonical = input.units.find(t => t.id === u.unitId);
    if (!original || !canonical || !Array.isArray(u.meetings) || u.meetings.length !== original.meetings.length) fail('Repair mengubah jumlah slot/Bab.');
    for (const m of u.meetings) {
      if (!m || typeof m.title !== 'string' || !m.title.trim() || !Array.isArray(m.materialIds) || !m.materialIds.length ||
          new Set(m.materialIds).size !== m.materialIds.length || m.materialIds.some(id => !canonical!.materials.some(mat => mat.id === id)) ||
          Object.keys(m).some(key => !['title', 'materialIds'].includes(key))) fail('Repair memiliki judul, field, atau referensi materi invalid.');
    }
  }
  const next = input.suggestions.map(u => response.units.find(r => r.unitId === u.unitId) || u);
  const remaining = inspectMeetingCoverage(input.units, next, input.existing);
  if (remaining.length) fail(`Repair satu kali belum memenuhi cakupan: ${JSON.stringify(remaining)}.`);
  return next;
}
