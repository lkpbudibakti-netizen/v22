import type { ATPData, TPData, ATPUnitMapping, ATPUnitMappingData, MappingChangeRecord } from '../types';
import { deriveMappingAtpIds } from './atpMappingLineageService';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { checkMappingSemanticEvidence } from '../../server/mappingSemanticEvidence';
import { validateStep07AutoExecution, hasStep07StoredSemanticSupport, type Step07AutoPermit } from './step07AutoExecutionPolicy';

export const ALIGNMENT_PRIORITY = ['EDIT_UNIT_TITLE', 'LINK_TP', 'EDIT_MATERIAL', 'ADD_MATERIAL', 'MOVE_MATERIAL', 'RESTRUCTURE_UNIT'] as const;
export type AlignmentActionType = typeof ALIGNMENT_PRIORITY[number];
export interface AlignmentAction {
  replaceTpIds?: boolean;
  id: string;
  type: AlignmentActionType;
  targetUnitId: string;
  targetMaterialId?: string;
  sourceUnitId?: string;
  linkedTpIds: string[];
  before?: string;
  after?: string;
  materialOrder?: string[];
  reason: string;
  evidence: { tpId: string; tpQuote: string; materialQuote: string }[];
}
export interface AlignmentProposal {
  actionId?:string;
  sourceEvidenceRepairs?:string[];
  executionClass?: 'AUTO_APPLY' | 'NEEDS_APPROVAL';
  changeKind?: MappingChangeRecord['kind'];
  approval?: 'AUTOMATIC' | 'TEACHER';
  id: string;
  action?: AlignmentAction;
  validationStatus?: 'READY' | 'REJECTED' | 'ALREADY_APPLIED';
  validationIssues?: string[];
  proposalType?: string;
  reason: string;
  before: string;
  after: string;
  targetUnitId: string;
  targetMaterialId?: string;
  tpIds: string[];
  impact: { newlyCoveredTpIds: string[]; newlyMappedAtpIds: string[] };
}

/** Closed equivalence rules, not word-count similarity or AI assertions of equivalence. */
export function mappingTitleKey(title: string): string {
  return title.normalize('NFC').toLocaleLowerCase('id').replace(/\baktifitas\b/g, 'aktivitas')
    .replace(/\btehnik\b/g, 'teknik').replace(/\bkordinasi\b/g, 'koordinasi')
    .trim().replace(/[.!?]+$/g, '').replace(/\s+/g, ' ').replace(/\s*([,;:])\s*/g, '$1 ');
}
export function mappingTitleMeaning(title: string): string {
  return mappingTitleKey(title).replace(/\bgerakan (?=(?:lokomotor|nonlokomotor|non-lokomotor|manipulatif)\b)/g, 'gerak ');
}
export function classifyMappingTitle(before: string, after: string): 'COPYEDIT' | 'RENAME' | 'CONTENT_CHANGE' {
  if (mappingTitleKey(before) === mappingTitleKey(after)) return 'COPYEDIT';
  if (mappingTitleMeaning(before) === mappingTitleMeaning(after)) return 'RENAME';
  return 'CONTENT_CHANGE';
}
export function mappingActionKind(action: AlignmentAction, units: ATPUnitMapping[]): MappingChangeRecord['kind'] {
  const unit = units.find(u => u.id === action.targetUnitId);
  const material = unit?.materials.find(m => m.id === action.targetMaterialId);
  if (action.type === 'EDIT_UNIT_TITLE') return classifyMappingTitle(unit?.title || '', action.after || '');
  if (action.type === 'EDIT_MATERIAL') {
    const sameLinks = material && action.linkedTpIds.length === material.linkedTpIds.length && action.linkedTpIds.every(id => material.linkedTpIds.includes(id));
    return sameLinks ? classifyMappingTitle(material!.title, action.after || '') : 'CONTENT_CHANGE';
  }
  return action.type === 'LINK_TP' ? 'REALIGN' : 'CONTENT_CHANGE';
}
export function mappingRevisionKeys(units: ATPUnitMapping[]) {
  return {
    structure: JSON.stringify(units.map(u => [u.id, u.order, u.materials.map(m => [m.id, m.order])])),
    substance: JSON.stringify(units.map(u => [u.id, mappingTitleMeaning(u.title), [...u.linkedTpIds].sort(), [...u.linkedAtpItemIds].sort(),
      u.materials.map(m => [m.id, mappingTitleMeaning(m.title), [...m.linkedTpIds].sort(), [...m.linkedAtpItemIds].sort()])])),
    presentation: JSON.stringify(units.map(u => [u.id, u.title, u.materials.map(m => [m.id, m.title])])),
  };
}

/** Preserve the existing dependency timestamp for proven presentation-only edits. */
export function versionMappingUpdate(previous: ATPUnitMappingData | undefined, value: ATPUnitMappingData, now = new Date().toISOString()): ATPUnitMappingData {
  const next = structuredClone(value);
  if (!previous) return { ...next, revisions: { structure: 1, substance: 1, presentation: 1 }, presentationUpdatedAt: now };
  const before = mappingRevisionKeys(previous.units), after = mappingRevisionKeys(next.units);
  const structureChanged = before.structure !== after.structure;
  const substanceChanged = before.substance !== after.substance || previous.atpId !== next.atpId || previous.tpDataId !== next.tpDataId ||
    previous.basedOnTpFingerprint !== next.basedOnTpFingerprint || previous.basedOnAtpFingerprint !== next.basedOnAtpFingerprint;
  const presentationChanged = before.presentation !== after.presentation;
  const revision = (key: 'structure' | 'substance' | 'presentation', changed: boolean) => Math.max(1, Number.isSafeInteger(previous.revisions?.[key]) ? previous.revisions![key] : 1) + Number(changed);
  next.revisions = { structure: revision('structure', structureChanged), substance: revision('substance', substanceChanged), presentation: revision('presentation', presentationChanged) };
  next.presentationUpdatedAt = presentationChanged ? now : previous.presentationUpdatedAt;
  if (!structureChanged && !substanceChanged) next.updatedAt = previous.updatedAt;
  else if (next.updatedAt === previous.updatedAt) next.updatedAt = now === previous.updatedAt ? new Date(Date.parse(now) + 1).toISOString() : now;
  for (const unit of next.units) {
    const oldUnit = previous.units.find(u => u.id === unit.id);
    if (!oldUnit) continue;
    for (const entity of [unit, ...unit.materials]) {
      const old = entity === unit ? oldUnit : oldUnit.materials.find(m => m.id === entity.id);
      if (!old) continue;
      if (entity.originalTitle === undefined && old.originalTitle !== undefined) entity.originalTitle = old.originalTitle;
      if (entity.titleHistory === undefined && old.titleHistory !== undefined) entity.titleHistory = structuredClone(old.titleHistory);
      if (old.title !== entity.title) {
        entity.originalTitle ??= old.title;
        const latest = entity.titleHistory?.at(-1);
        if (latest?.before !== old.title || latest.after !== entity.title) entity.titleHistory = [...(entity.titleHistory || []), {
          id: `manual-${unit.id}-${entity.id}-${now}`, at: now, kind: classifyMappingTitle(old.title, entity.title), approval: 'TEACHER',
          unitId: unit.id, materialId: entity === unit ? undefined : entity.id, before: old.title, after: entity.title, reason: 'Judul diedit dan disimpan guru.',
        }];
      }
    }
    if (unit.actionHistory === undefined && oldUnit.actionHistory !== undefined) unit.actionHistory = structuredClone(oldUnit.actionHistory);
  }
  return next;
}
export function undoMappingTitle(units: ATPUnitMapping[], unitId: string, materialId?: string) {
  const next = structuredClone(units), unit = next.find(u => u.id === unitId);
  const entity = materialId ? unit?.materials.find(m => m.id === materialId) : unit;
  if (!entity) return { success: false, issues: ['Judul target undo tidak ditemukan.'] };
  const history = entity.titleHistory || [];
  const record = [...history].reverse().find(r => r.kind !== 'UNDO' && !history.some(h => h.undoOf === r.id));
  if (!record || entity.title !== record.after) return { success: false, issues: ['Undo ditolak: judul telah diedit manual atau tidak ada riwayat yang dapat dibatalkan.'] };
  entity.title = record.before;
  entity.titleHistory = [...history, { ...record, id: `undo-${record.id}`, at: new Date().toISOString(), kind: 'UNDO', approval: 'TEACHER', before: record.after, after: record.before, undoOf: record.id }];
  return { success: true, issues: [], nextUnits: next };
}

export interface MappingPedagogicalFinding {
  id: string;
  unitId?: string;
  materialId?: string;
  category: 'GLOBAL_COVERAGE' | 'UNIT_LINEAGE' | 'MATERIAL_SUPPORT' | 'TITLE_QUALITY' | 'POSSIBLE_DUPLICATE';
  priority: 'P1' | 'P2' | 'P3';
  actual: string;
  evidence: string;
  recommendation: string;
  impact: string;
  approval: 'AUTOMATIC' | 'TEACHER';
  status: 'OPEN' | 'NEEDS_REVIEW' | 'RESOLVED';
}

/** Report projection of the existing validator, never a second readiness engine. */
export function buildMappingPedagogicalReport(units: ATPUnitMapping[], atp: ATPData, tp: TPData): MappingPedagogicalFinding[] {
  const result = mappingCoverage(units, atp, tp), findings: MappingPedagogicalFinding[] = [];
  const add = (finding: MappingPedagogicalFinding) => findings.push(finding);
  if (result.unmappedAtpIds.length || result.uncoveredTpIds.length) add({ id: 'coverage-global', category: 'GLOBAL_COVERAGE', priority: 'P1',
    actual: `ATP belum tercakup: ${result.unmappedAtpIds.join(', ') || '-'}; TP belum tercakup: ${result.uncoveredTpIds.join(', ') || '-'}.`,
    evidence: 'Perhitungan ID kanonikal oleh validator, terpisah dari dukungan setiap Bab.', recommendation: 'Tinjau TP dan materi relevan; jangan menambahkan relasi hanya demi angka coverage.',
    impact: 'Step 08 terkunci sampai cakupan lengkap.', approval: 'TEACHER', status: 'OPEN' });
  for (const gap of result.materialCoverageGaps) add({ id: `lineage-${gap.unitId}`, unitId: gap.unitId, category: 'UNIT_LINEAGE', priority: 'P1',
    actual: `Bab ${gap.unitTitle} mengklaim TP ${gap.tpIds.map(id => tp.items.find(t => t.id === id)?.code || id).join(', ') || '-'} / ATP ${gap.atpItemIds.join(', ') || '-'} tanpa dukungan gabungan materi.`,
    evidence: 'TP/ATP Bab dibandingkan dengan gabungan ID pada materi di Bab yang sama.',
    recommendation: 'Pilihan guru: tautkan materi existing hanya bila cakupan dan kompetensinya sesuai; atau koreksi klaim TP Bab bila tidak relevan. Jika materi benar-benar belum ada, susun usulan cakupan secara eksplisit lalu tinjau. Tidak ada pilihan yang diterapkan otomatis.',
    impact: 'Data manual dipertahankan; Step 08 tetap terkunci sampai gap dituntaskan.', approval: 'TEACHER', status: 'OPEN' });
  const all = units.flatMap(unit => unit.materials.map(material => ({ unit, material })));
  for (const unitId of result.unitsWithoutLineage) add({ id: `lineage-empty-${unitId}`, unitId, category: 'UNIT_LINEAGE', priority: 'P1',
    actual: `Bab "${units.find(unit => unit.id === unitId)?.title || unitId}" belum memiliki lineage TP/ATP lengkap.`, evidence: 'Validator menemukan relasi TP/ATP Bab kosong meskipun coverage global mungkin sudah lengkap.',
    recommendation: 'Tinjau substansi dan kompetensi materi dalam Bab, lalu setujui hanya relasi TP yang didukung substansi; ATP mengikuti induk TP kanonikal.',
    impact: 'Bab tetap dipertahankan; Step 08 belum READY sampai lineage lengkap.', approval: 'TEACHER', status: 'NEEDS_REVIEW' });
  for (const ref of result.materialsWithoutLineage) add({ id: `support-empty-${ref.unitId}-${ref.materialId}`, unitId: ref.unitId, materialId: ref.materialId, category: 'MATERIAL_SUPPORT', priority: 'P1',
    actual: `Materi "${all.find(({ unit, material }) => unit.id === ref.unitId && material.id === ref.materialId)?.material.title || ref.materialId}" belum memiliki lineage TP/ATP lengkap.`, evidence: 'Validator menemukan relasi materi kosong; judul singkat atau tidak adanya keyword tidak membuktikan ketidakrelevanan.',
    recommendation: 'Minta usulan TP dengan alasan substansi, kompetensi dan cakupan dalam konteks Bab. Untuk TP luas, jelaskan relevansi substansi terhadap kompetensinya; jangan menambah materi atau menautkan TP hanya demi coverage.',
    impact: 'Materi manual dipertahankan; relasi baru memerlukan persetujuan guru dan validasi ulang.', approval: 'TEACHER', status: 'NEEDS_REVIEW' });
  for (const { unit, material } of all) {
    for (const id of material.linkedTpIds) {
      const objective = tp.items.find(t => t.id === id);
      if (!objective) continue;
      const signal = checkMappingSemanticEvidence({ label: material.title, tpItems: [objective] });
      add({ id: `support-${unit.id}-${material.id}-${id}`, unitId: unit.id, materialId: material.id, category: 'MATERIAL_SUPPORT', priority: signal.hardConflict ? 'P1' : 'P2',
        actual: `Materi "${material.title}" tertaut ke ${objective.code || id}.`, evidence: `TP: "${objective.statement}". ${signal.reason} Kecocokan kata saja bukan bukti kesetaraan pedagogis.`,
        recommendation: signal.hardConflict ? 'Tinjau atau lepaskan hubungan yang bertentangan melalui keputusan guru.' : 'Konfirmasikan relevansi substansi, kompetensi dan cakupan; pertahankan relasi manual sampai keputusan guru.',
        impact: signal.hardConflict ? 'Konflik eksplisit mengunci kesiapan.' : 'Tidak ada relasi atau materi yang diubah oleh laporan.', approval: 'TEACHER', status: signal.hardConflict ? 'OPEN' : hasTeacherMaterialSupport(unit, material, tp) ? 'RESOLVED' : 'NEEDS_REVIEW' });
    }
    const duplicates = all.filter(other => other.material.id !== material.id && mappingTitleMeaning(other.material.title) === mappingTitleMeaning(material.title));
    if (duplicates.length) add({ id: `duplicate-${unit.id}-${material.id}`, unitId: unit.id, materialId: material.id, category: 'POSSIBLE_DUPLICATE', priority: 'P3',
      actual: `Judul juga dipakai pada materi ${duplicates.map(d => d.material.id).join(', ')}.`, evidence: `Fokus TP saat ini: ${material.linkedTpIds.join(', ')}; pembanding: ${duplicates.map(d => d.material.linkedTpIds.join(', ')).join(' / ')}.`,
      recommendation: 'Bandingkan fokus dan progresi. Judul sama dengan fokus berbeda dapat dipertahankan; jangan menghapus otomatis.', impact: 'Tidak mengurangi materi atau coverage.', approval: 'TEACHER', status: 'NEEDS_REVIEW' });
  }
  for (const unit of units) for (const entity of [unit, ...unit.materials]) {
    if (suggestMappingCopyedit(entity.title) === entity.title) continue;
    add({ id: `title-${unit.id}-${entity.id}`, unitId: unit.id, materialId: entity === unit ? undefined : entity.id, category: 'TITLE_QUALITY', priority: 'P3', actual: entity.title,
      evidence: 'Aturan ejaan/spasi deterministik, tanpa perubahan TP/ATP.', recommendation: suggestMappingCopyedit(entity.title), impact: 'Presentasi saja.', approval: 'AUTOMATIC', status: 'OPEN' });
  }
  return findings.sort((a,b) => a.priority.localeCompare(b.priority) || a.id.localeCompare(b.id));
}

export function suggestMappingCopyedit(title: string): string {
  const cleaned = title.trim().replace(/\s+/g, ' ').replace(/\baktifitas\b/gi, 'aktivitas').replace(/\btehnik\b/gi, 'teknik').replace(/\bkordinasi\b/gi, 'koordinasi');
  return cleaned ? cleaned[0].toLocaleUpperCase('id') + cleaned.slice(1) : cleaned;
}

function reviewedTpFingerprint(ids: string[], tp: TPData): string {
  return JSON.stringify(tp.items.filter(t => ids.includes(t.id)).map(t => ({ id: t.id, statement: t.statement, competence: t.competence, contentScope: t.contentScope })).sort((a,b)=>a.id.localeCompare(b.id)));
}
function mappingProposition(text:string):string {
  return mappingTitleMeaning(text.replace(/^peserta didik\s+(?:(?:mampu|dapat)\s+)?/i,'').trim());
}
export function hasTeacherMaterialSupport(unit: ATPUnitMapping, material: ATPUnitMapping['materials'][number], tp: TPData): boolean {
  const approved = new Set<string>();
  const history=[...(unit.actionHistory || []), ...(material.titleHistory || [])];
  for (const record of history) {
    if (record.kind==='UNDO' || history.some(h=>h.undoOf===record.id)) continue;
    const scopedAutomatic=record.approval==='AUTOMATIC'&&record.executionContext==='STEP07_AUTO_REPAIR'&&!!record.reviewedUnitTitle&&mappingTitleMeaning(record.reviewedUnitTitle)===mappingTitleMeaning(unit.title)&&hasStep07StoredSemanticSupport(record,material,tp);
    const independentAutomatic=scopedAutomatic || record.executionContext!=='STEP07_AUTO_REPAIR' && record.approval==='AUTOMATIC' && record.kind==='REALIGN' && record.reviewedTpIds?.length===1 &&
      tp.items.filter(t=>mappingProposition(t.statement)===mappingProposition(material.title)).length===1 &&
      tp.items.some(t=>t.id===record.reviewedTpIds![0]&&mappingProposition(t.statement)===mappingProposition(material.title));
    if ((record.approval !== 'TEACHER' && !independentAutomatic) || record.materialId !== material.id || !record.reviewedTitle || !record.reviewedTpIds ||
      mappingTitleMeaning(record.reviewedTitle) !== mappingTitleMeaning(material.title) ||
      record.reviewedTpFingerprint !== reviewedTpFingerprint(record.reviewedTpIds, tp)) continue;
    record.reviewedTpIds.forEach(id => approved.add(id));
  }
  return material.linkedTpIds.length > 0 && material.linkedTpIds.every(id => approved.has(id));
}

/** Independent authority: AI confidence cannot authorize a new TP relationship. */
export function isMappingActionAutomatic(action: AlignmentAction, units: ATPUnitMapping[], tp: TPData): boolean {
  if (['COPYEDIT','RENAME'].includes(mappingActionKind(action, units))) return true;
  const unit = units.find(u => u.id === action.targetUnitId), material = unit?.materials.find(m => m.id === action.targetMaterialId);
  if (action.type!=='LINK_TP' || !unit || !material || material.title!==action.before) return false;
  if ([...(unit.actionHistory || [])].reverse().find(record=>record.materialId===material.id&&['UNDO','REALIGN'].includes(record.kind))?.kind==='UNDO') return false;
  if (action.linkedTpIds.length === material.linkedTpIds.length && action.linkedTpIds.every(id => material.linkedTpIds.includes(id)) && hasTeacherMaterialSupport(unit, material, tp)) return true;
  // Complete proposition equivalence, never keyword overlap or AI's confidence.
  const equivalent=tp.items.filter(objective=>mappingProposition(objective.statement)===mappingProposition(material.title));
  return !material.linkedTpIds.length && action.linkedTpIds.length===1 && equivalent.length===1 && equivalent[0].id===action.linkedTpIds[0] &&
    !unit.actionHistory?.some(record=>record.materialId===material.id);
}

export function formatMappingUnitTitle(unit: Pick<ATPUnitMapping, 'order' | 'title'>): string {
  const label = unit.title.replace(/^(?:\s*Bab\s+\d+\s*[:.\-]?\s*)+/i, '').trim();
  return `Bab ${unit.order}${label ? `: ${label}` : ''}`;
}

export function mappingMaterialOrigin(unit: ATPUnitMapping, material: ATPUnitMapping['materials'][number]): 'TEACHER_APPROVED' | 'AUTO_VERIFIED' | 'UNVERIFIED' | 'EXISTING' {
  if (!material.id.startsWith('alignment-')) return 'EXISTING';
  if(unit.actionHistory?.some(record=>record.materialId===material.id&&record.executionContext==='STEP07_AUTO_REPAIR'&&record.approval==='AUTOMATIC'&&record.semanticVerification?.verdict==='SUPPORTED'&&record.after===material.title))return 'AUTO_VERIFIED';
  return unit.actionHistory?.some(record => record.materialId === material.id && record.kind === 'CONTENT_CHANGE' && record.approval === 'TEACHER' && record.after === material.title)
    ? 'TEACHER_APPROVED' : 'UNVERIFIED';
}

export function confirmMappingMaterialOrigin(units: ATPUnitMapping[], unitId: string, materialId: string, expectedTitle: string): ATPUnitMapping[] {
  const next = structuredClone(units), unit = next.find(u => u.id === unitId), material = unit?.materials.find(m => m.id === materialId);
  if (!unit || !material || material.title !== expectedTitle) throw new Error('Materi berubah; tinjau ulang sebelum memberi persetujuan.');
  if (mappingMaterialOrigin(unit, material) !== 'UNVERIFIED') return next;
  unit.actionHistory = [...(unit.actionHistory || []), { id:`origin-${material.id}-${Date.now()}`, at:new Date().toISOString(), kind:'CONTENT_CHANGE', approval:'TEACHER', unitId, materialId,
    before:'Otorisasi historis belum terbukti', after:material.title, reason:'Guru menyetujui keberadaan materi saat ini; tidak mengklaim otorisasi historis.' }];
  return next;
}

export function undoMappingRelation(units:ATPUnitMapping[], unitId:string, recordId:string, atp:ATPData, tp:TPData) {
  const next=structuredClone(units), unit=next.find(u=>u.id===unitId), record=unit?.actionHistory?.find(r=>r.id===recordId), material=unit?.materials.find(m=>m.id===record?.materialId);
  if (!unit || !record?.beforeLinks || !record.afterLinks || !material || unit.actionHistory?.some(r=>r.undoOf===recordId)) return {success:false,issues:['Riwayat relasi yang dapat dibatalkan tidak tersedia.']};
  const current={materialTpIds:material.linkedTpIds,materialAtpIds:material.linkedAtpItemIds,unitTpIds:unit.linkedTpIds,unitAtpIds:unit.linkedAtpItemIds};
  if (JSON.stringify(current)!==JSON.stringify(record.afterLinks) || material.title!==record.reviewedTitle) return {success:false,issues:['Undo ditolak: relasi atau judul telah berubah setelah tindakan.']};
  material.linkedTpIds=[...record.beforeLinks.materialTpIds];material.linkedAtpItemIds=[...record.beforeLinks.materialAtpIds];
  unit.linkedTpIds=[...new Set([...record.beforeLinks.unitTpIds,...unit.materials.flatMap(m=>m.linkedTpIds)])];
  unit.linkedAtpItemIds=[...new Set([...record.beforeLinks.unitAtpIds,...unit.materials.flatMap(m=>m.linkedAtpItemIds),...deriveMappingAtpIds(unit.linkedTpIds,atp,tp).atpItemIds])];
  const validation=mappingCoverage(next,atp,tp);
  if (!validation.isValid) return {success:false,issues:validation.issues};
  unit.actionHistory=[...(unit.actionHistory||[]),{...record,id:`undo-${record.id}`,at:new Date().toISOString(),kind:'UNDO',approval:'TEACHER',undoOf:record.id,before:record.after,after:record.before,beforeLinks:record.afterLinks,afterLinks:{materialTpIds:material.linkedTpIds,materialAtpIds:material.linkedAtpItemIds,unitTpIds:unit.linkedTpIds,unitAtpIds:unit.linkedAtpItemIds}}];
  return {success:true,issues:[],nextUnits:next};
}

export function buildMappingMaterialResolutions(units: ATPUnitMapping[], atp: ATPData, tp: TPData, proposals: AlignmentProposal[] = [], gaps: {kind:string;id:string;reason:string}[] = []) {
  return units.flatMap(unit => unit.materials.map(material => {
    const matches = proposals.filter(p => p.targetUnitId === unit.id && p.targetMaterialId === material.id);
    const approved = hasTeacherMaterialSupport(unit, material, tp);
    const parents=deriveMappingAtpIds(material.linkedTpIds, atp, tp);
    const complete = material.linkedTpIds.length > 0 && !parents.issues.length && parents.atpItemIds.length===material.linkedAtpItemIds.length && parents.atpItemIds.every(id=>material.linkedAtpItemIds.includes(id)) && !checkMappingSemanticEvidence({label:material.title,tpItems:tp.items.filter(t=>material.linkedTpIds.includes(t.id))}).hardConflict;
    const actionable = matches.filter(p => p.action && alignmentProposalStatus(p) === 'READY');
    const origin = mappingMaterialOrigin(unit, material);
    return { unitId:unit.id, materialId:material.id, title:material.title, origin,
      linkedTpIds:[...material.linkedTpIds], linkedAtpItemIds:[...material.linkedAtpItemIds],
      status: complete && approved && origin !== 'UNVERIFIED' ? 'RESOLVED' as const : actionable.length ? 'NEEDS_APPROVAL' as const : 'NEEDS_REVIEW' as const,
      reason: complete && approved ? 'Relasi tersimpan memiliki bukti persetujuan guru atau kesetaraan proposisi lengkap yang diperiksa independen untuk judul dan TP saat ini.' :
        gaps.find(g => g.kind === 'MATERIAL' && g.id === material.id)?.reason || matches.find(p => p.validationIssues?.length)?.reason ||
        'Belum ada usulan semantik terverifikasi. Judul saja belum membuktikan kompetensi; guru perlu meninjau relevansi substansi dan cakupan.',
      proposalIds:actionable.map(p => p.id),
      suggestedReason:matches.find(p=>p.reason?.trim())?.reason,
      candidates: tp.items.map(objective => {
        const parents = deriveMappingAtpIds([objective.id], atp, tp), conflict = checkMappingSemanticEvidence({label:material.title,tpItems:[objective]});
        const suggested = matches.find(p => p.tpIds.includes(objective.id));
        return {tpId:objective.id,atpIds:parents.atpItemIds,code:objective.code,statement:objective.statement,competence:objective.competence,
          materialQuote:material.title,reason:suggested?.reason || 'Opsi pembanding kanonikal, bukan rekomendasi relevansi. Jelaskan relevansi substansi materi terhadap kompetensi TP sebelum menyetujui.',
          blocked:parents.issues.length > 0 || conflict.hardConflict, issues:[...parents.issues,...(conflict.hardConflict?[conflict.reason]:[])],
          suggested:!!suggested,needsEvidence:!!suggested && alignmentProposalStatus(suggested)!=='READY',impact:'Menambah relasi pada materi existing; ATP diturunkan dari TP. Tidak menambah materi atau mengubah TP kanonikal.'};
      }),
    };
  }));
}

export function recordMappingBatch(units: ATPUnitMapping[], next: ATPUnitMapping[], reason: string, undo = false): ATPUnitMapping[] {
  const copy = structuredClone(next);
  if (undo) for (const unit of copy) {
    const old = units.find(u => u.id === unit.id);
    if (!old) continue;
    unit.actionHistory = [...(old.actionHistory || [])];
    for (const entity of [unit, ...unit.materials]) {
      const previous = entity === unit ? old : old.materials.find(m => m.id === entity.id);
      if (!previous) continue;
      entity.titleHistory = structuredClone(previous.titleHistory || []);
      entity.originalTitle ??= previous.originalTitle;
      const record = entity.titleHistory.at(-1);
      if (record && record.before === entity.title && record.after === previous.title) entity.titleHistory.push({ ...record,
        id: `undo-${record.id}`, kind: 'UNDO', approval: 'TEACHER', at: new Date().toISOString(), before: previous.title, after: entity.title, undoOf: record.id });
    }
  }
  if (copy.length && JSON.stringify(mappingRevisionKeys(units)) !== JSON.stringify(mappingRevisionKeys(copy))) copy[0].actionHistory = [...(copy[0].actionHistory || []), {
    id: `batch-${Date.now()}-${copy[0].actionHistory?.length || 0}`, at: new Date().toISOString(), kind: undo ? 'UNDO' : 'CONTENT_CHANGE', approval: 'TEACHER', unitId: copy[0].id,
    before: JSON.stringify(mappingRevisionKeys(units)), after: JSON.stringify(mappingRevisionKeys(copy)), reason,
  }];
  return copy;
}

export function alignmentProposalStatus(proposal: AlignmentProposal): 'READY' | 'REJECTED' | 'ALREADY_APPLIED' {
  if (proposal.validationStatus === 'ALREADY_APPLIED') return 'ALREADY_APPLIED';
  if (proposal.action && proposal.validationStatus !== 'REJECTED') return 'READY';
  return 'REJECTED';
}

export function refreshAlignmentProposals(proposals:AlignmentProposal[],units:ATPUnitMapping[],atp:ATPData,tp:TPData):AlignmentProposal[] {
  return proposals.map(proposal=>{
    if (!proposal.action) return proposal;
    const preview=applyMinimalAlignment(units,[proposal.action],atp,tp);
    if (!preview.success) return {...proposal,action:undefined,validationStatus:'REJECTED',validationIssues:preview.issues,reason:preview.issues.join('; ')};
    if (JSON.stringify(preview.nextUnits)===JSON.stringify(units)) return {...proposal,action:undefined,validationStatus:'ALREADY_APPLIED',reason:'Sudah diterapkan dan divalidasi pada draf saat ini.'};
    return proposal;
  });
}

export function alignmentProposalDiagnostics(proposals: AlignmentProposal[]) {
  const reasons = new Map<string, number>();
  for (const proposal of proposals.filter(p => alignmentProposalStatus(p) === 'REJECTED')) {
    for (const issue of proposal.validationIssues?.length ? proposal.validationIssues : [proposal.reason]) reasons.set(issue, (reasons.get(issue) || 0) + 1);
  }
  return { ready: proposals.filter(p => alignmentProposalStatus(p) === 'READY' && p.approval !== 'AUTOMATIC').length,
    rejected: proposals.filter(p => alignmentProposalStatus(p) === 'REJECTED').length,
    alreadyApplied: proposals.filter(p => alignmentProposalStatus(p) === 'ALREADY_APPLIED').length,
    rejectionReasons: [...reasons].map(([reason, count]) => ({ reason, count })) };
}

/** Used by the checkbox and regression; rejected IDs cannot enter the selection. */
export function toggleAlignmentProposalSelection(proposals: AlignmentProposal[], previous: Set<string>, id: string) {
  const ready = new Set(proposals.filter(p => alignmentProposalStatus(p) === 'READY' && p.approval !== 'AUTOMATIC').map(p => p.id));
  const next = new Set([...previous].filter(selected => ready.has(selected)));
  if (!ready.has(id)) return next;
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

export function mappingCoverage(units: ATPUnitMapping[], atp: ATPData, tp: TPData) {
  return validateATPUnitMappingCanonical({ id: 'alignment', academicSettingId: '', atpId: atp.id, units, updatedAt: '' }, atp, tp);
}

/** Mutate only a cloned draft, then validate the entire candidate. Existing incomplete data stays visible. */
export function applyMinimalAlignment(units: ATPUnitMapping[], actions: AlignmentAction[], atp: ATPData, tp: TPData, approval: 'TEACHER' | 'AUTOMATIC' | Step07AutoPermit = 'TEACHER') {
  const scoped=typeof approval==='object';
  if(scoped){const issues=validateStep07AutoExecution(units,actions,atp,tp,approval,action=>isMappingActionAutomatic(action,units,tp));if(issues.length)return {success:false,issues};}
  const recordApproval=scoped?'AUTOMATIC':approval;
  const authority=(action:AlignmentAction)=>scoped?{executionContext:'STEP07_AUTO_REPAIR' as const,semanticVerification:approval.checks.find(check=>check.actionId===action.id),reviewedUnitTitle:next.find(unit=>unit.id===action.targetUnitId)?.title}:{};
  const next = structuredClone(units);
  const issues: string[] = [];
  const fail = (reason: string) => { issues.push(reason); };
  const usedMaterials = new Set<string>();
  const usedIds = new Set<string>();
  for (const action of [...actions].sort((a, b) => ALIGNMENT_PRIORITY.indexOf(a?.type) - ALIGNMENT_PRIORITY.indexOf(b?.type))) {
    if (!action || !ALIGNMENT_PRIORITY.includes(action.type)) { fail('Tipe proposal tidak dikenal.'); continue; }
    if (!action.id || usedIds.has(action.id)) { fail('ID proposal kosong/duplikat.'); continue; }
    if (approval === 'AUTOMATIC' && !isMappingActionAutomatic(action, units, tp)) { fail('AUTO_APPLY ditolak: otorisasi independen tidak tersedia.'); continue; }
    usedIds.add(action.id);
    const target = next.find(u => u.id === action.targetUnitId);
    const source = next.find(u => u.id === (action.sourceUnitId || action.targetUnitId));
    const original = units.find(u => u.id === (action.sourceUnitId || action.targetUnitId))?.materials.find(m => m.id === action.targetMaterialId);
    const material = source?.materials.find(m => m.id === action.targetMaterialId);
    if (!target || !source) { fail('ID Bab target/sumber tidak ditemukan.'); continue; }
    if (typeof action.reason !== 'string' || !action.reason.trim()) { fail('Alasan pedagogis wajib tersedia.'); continue; }
    const titleEntity = action.type === 'EDIT_UNIT_TITLE' ? target : action.type === 'EDIT_MATERIAL' ? material : undefined;
    const onlyTitle = action.type === 'EDIT_UNIT_TITLE' || (action.type === 'EDIT_MATERIAL' && material &&
      action.linkedTpIds.length === material.linkedTpIds.length && action.linkedTpIds.every(id => material.linkedTpIds.includes(id)));
    if (onlyTitle && titleEntity) {
      if (titleEntity.title === action.after) continue;
      if (titleEntity.title !== action.before) { fail('BEFORE_MISMATCH: judul berubah sejak analisis.'); continue; }
      if (typeof action.after !== 'string' || !action.after.trim()) { fail('Judul hasil penyelarasan kosong.'); continue; }
      const kind = classifyMappingTitle(titleEntity.title, action.after);
      if (titleEntity.titleHistory?.some(h => h.kind === 'UNDO' && h.after === titleEntity.title && h.before === action.after)) continue;
      if (kind !== 'CONTENT_CHANGE' && titleEntity.titleHistory?.some(h => h.approval === 'AUTOMATIC' && h.after === titleEntity.title) && action.after !== suggestMappingCopyedit(titleEntity.title)) continue;
      if (kind === 'CONTENT_CHANGE') {
        const ids = titleEntity.linkedTpIds;
        if (!ids.length || ids.some(id => {
          const objective = tp.items.find(t => t.id === id), evidence = action.evidence?.find(e => e.tpId === id);
          return !objective || !evidence?.tpQuote || !objective.statement.includes(evidence.tpQuote) || evidence.tpQuote.length < Math.min(12, objective.statement.length) ||
            !evidence.materialQuote || !titleEntity.title.includes(evidence.materialQuote) || evidence.materialQuote.length < Math.min(8, titleEntity.title.length) ||
            checkMappingSemanticEvidence({ label: action.after!, tpItems: [objective] }).hardConflict;
        })) { fail('CONTENT_CHANGE membutuhkan bukti TP/materi yang dapat diverifikasi dan persetujuan guru.'); continue; }
      }
      const key = `${target.id}:${action.targetMaterialId || 'title'}`;
      if (usedMaterials.has(key)) { fail('Proposal judul bertentangan; pilih satu alternatif.'); continue; }
      usedMaterials.add(key);
      titleEntity.originalTitle ??= titleEntity.title;
      titleEntity.titleHistory = [...(titleEntity.titleHistory || []), {
        id: `title-${action.id}-${titleEntity.titleHistory?.length || 0}`, at: new Date().toISOString(), kind,
        approval: scoped?'AUTOMATIC':kind === 'CONTENT_CHANGE' ? 'TEACHER' : 'AUTOMATIC', ...authority(action), unitId: target.id, materialId: action.targetMaterialId,
        before: titleEntity.title, after: action.after, reason: action.reason,
        ...(kind === 'CONTENT_CHANGE' && action.targetMaterialId ? { reviewedTitle: action.after, reviewedTpIds: [...titleEntity.linkedTpIds], reviewedTpFingerprint: reviewedTpFingerprint(titleEntity.linkedTpIds, tp) } : {}),
      }];
      titleEntity.title = action.after;
      continue;
    }
    const teacherClearing=approval==='TEACHER' && action.type==='LINK_TP' && action.replaceTpIds;
    if (!Array.isArray(action.linkedTpIds) || (!action.linkedTpIds.length && !teacherClearing) || new Set(action.linkedTpIds).size !== action.linkedTpIds.length) { fail('Subset TP wajib eksplisit, tidak kosong/duplikat.'); continue; }
    const parents = deriveMappingAtpIds(action.linkedTpIds, atp, tp);
    if (parents.issues.length) { issues.push(...parents.issues); continue; }
    const alreadyMoved = action.type === 'MOVE_MATERIAL' && !material && target.materials.find(m => m.id === action.targetMaterialId);
    if (alreadyMoved && alreadyMoved.title === action.before && action.linkedTpIds.every(id => alreadyMoved.linkedTpIds.includes(id))) continue;
    if (action.type === 'EDIT_MATERIAL' && material?.title === action.after && action.linkedTpIds.every(id => material.linkedTpIds.includes(id))) continue;
    const title = action.type === 'EDIT_MATERIAL' || action.type === 'ADD_MATERIAL' ? action.after : material?.title;
    if (action.type !== 'RESTRUCTURE_UNIT') {
      if (typeof title !== 'string' || !title.trim()) { fail('Judul materi belum tersedia.'); continue; }
      if (action.type !== 'ADD_MATERIAL' && (!original || !material)) { fail('ID materi sumber tidak ditemukan.'); continue; }
      if (action.type !== 'ADD_MATERIAL' && action.before !== original!.title) { fail('BEFORE_MISMATCH: materi telah berubah; analisis ulang.'); continue; }
      if (action.targetMaterialId && usedMaterials.has(action.targetMaterialId)) { fail('Proposal bertentangan untuk materi yang sama; pilih satu alternatif.'); continue; }
      if (action.targetMaterialId) usedMaterials.add(action.targetMaterialId);
      for (const id of action.linkedTpIds) {
        const objective = tp.items.find(t => t.id === id)!;
        const evidence = Array.isArray(action.evidence) ? action.evidence.find(e => e?.tpId === id) : undefined;
        const sourceText = action.type === 'ADD_MATERIAL' ? title : original!.title;
        if (typeof evidence?.tpQuote !== 'string' || !evidence.tpQuote.trim() || !objective.statement.includes(evidence.tpQuote) ||
            typeof evidence.materialQuote !== 'string' || !evidence.materialQuote.trim() || !sourceText.includes(evidence.materialQuote)) {
          fail(`EVIDENCE_MISSING: kutipan sumber materi dan TP '${id}' harus dapat diverifikasi secara exact.`);
        } else if (evidence.tpQuote.trim().length < Math.min(12, objective.statement.trim().length) || evidence.materialQuote.trim().length < Math.min(8, sourceText.trim().length)) {
          fail(`EVIDENCE_TOO_SHORT: kutipan TP '${id}' dan materi harus memuat substansi sumber, bukan satu karakter/kata generik.`);
        }
        if (checkMappingSemanticEvidence({ label: title, tpItems: [objective] }).hardConflict) fail(`HARD_CONFLICT: materi berlawanan dengan TP '${id}'.`);
      }
      // Substantive edits require independent scoped verification or explicit teacher
      // authority above. Lexical overlap is a signal, not an additional semantic veto.
      if(action.type==='EDIT_MATERIAL'&&classifyMappingTitle(original!.title,title!)==='CONTENT_CHANGE'&&!scoped&&
        !action.evidence?.every(e=>typeof e.materialQuote==='string'&&mappingTitleMeaning(title!).includes(mappingTitleMeaning(e.materialQuote)))){
        fail('CONTENT_CHANGE: konteks materi sumber tidak dipertahankan; tinjau perubahan substansi sebelum menyetujui relasi.');
      }
      if (issues.length) continue;
      if (action.type === 'ADD_MATERIAL') {
        const existing = target.materials.find(m => m.title.trim().toLowerCase() === title.trim().toLowerCase());
        if (existing && (!action.linkedTpIds.every(id => existing.linkedTpIds.includes(id)))) { fail('DUPLICATE_MATERIAL: gunakan LINK_TP pada materi existing.'); continue; }
        if (existing) continue;
        if (!existing && next.some(u => u.materials.some(m => m.id === `alignment-${action.id}`))) { fail('ID materi baru sudah dipakai; analisis ulang.'); continue; }
        if (!existing) target.materials.push({ id: `alignment-${action.id}`, title, order: Math.max(0, ...target.materials.map(m => m.order)) + 1,
          linkedTpIds: [...action.linkedTpIds], linkedAtpItemIds: parents.atpItemIds });
      } else {
        if (action.type === 'MOVE_MATERIAL') {
          if (source.id === target.id) { fail('MOVE_MATERIAL memerlukan Bab tujuan berbeda.'); continue; }
          if (target.materials.some(m => m.id === material!.id || m.title === material!.title)) { fail('Materi tujuan duplikat.'); continue; }
          source.materials = source.materials.filter(m => m.id !== material!.id);
          target.materials.push(material!);
          material!.order = Math.max(0, ...target.materials.filter(m => m.id !== material!.id).map(m => m.order)) + 1;
        }
        if (action.type === 'EDIT_MATERIAL') {
          material!.originalTitle ??= material!.title;
          material!.titleHistory = [...(material!.titleHistory || []), { id: `title-${action.id}`, at: new Date().toISOString(), kind: 'CONTENT_CHANGE', approval: scoped?'AUTOMATIC':'TEACHER', ...authority(action), unitId: target.id, materialId: material!.id, before: material!.title, after: title!, reason: action.reason }];
          material!.title = title;
        }
        material!.linkedTpIds = [...new Set(action.type==='LINK_TP' && action.replaceTpIds ? action.linkedTpIds : [...material!.linkedTpIds, ...action.linkedTpIds])];
        const derived = deriveMappingAtpIds(material!.linkedTpIds, atp, tp);
        issues.push(...derived.issues);
        material!.linkedAtpItemIds = derived.atpItemIds;
      }
    } else {
      // The immutable Bab contract permits only regrouping the material sequence inside an existing Bab.
      if (action.linkedTpIds.some(id => !target.materials.some(m => m.linkedTpIds.includes(id)))) {
        fail('RESTRUCTURE_UNIT tidak boleh mengklaim coverage baru tanpa materi pendukung; gunakan LINK_TP lebih dahulu.'); continue;
      }
      const ids = action.materialOrder;
      if (!Array.isArray(ids) || ids.length !== target.materials.length || new Set(ids).size !== ids.length || ids.some(id => !target.materials.some(m => m.id === id))) {
        fail('RESTRUCTURE_UNIT hanya boleh mengurutkan seluruh ID materi existing; Bab/isi tidak boleh diganti.'); continue;
      }
      if (JSON.stringify(target.materials.map(m => m.id)) === JSON.stringify(ids)) continue;
      if (action.before !== JSON.stringify(units.find(u => u.id === target.id)!.materials.map(m => m.id))) { fail('BEFORE_MISMATCH: urutan materi berubah.'); continue; }
      target.materials = ids.map((id, index) => ({ ...target.materials.find(m => m.id === id)!, order: index + 1 }));
    }
    // Preserve unrelated declared lineage; movement may remove only lineage supported by the moved material.
    for (const unit of new Set([source, target])) {
      const moved = action.type === 'MOVE_MATERIAL' && unit.id === source.id;
      const replaced=action.type==='LINK_TP' && action.replaceTpIds && unit.id===target.id;
      const declaredTp = moved ? unit.linkedTpIds.filter(id => !material!.linkedTpIds.includes(id)) : replaced ? unit.linkedTpIds.filter(id=>!original!.linkedTpIds.includes(id) || unit.materials.some(m=>m.linkedTpIds.includes(id))) : unit.linkedTpIds;
      unit.linkedTpIds = [...new Set([...declaredTp, ...unit.materials.flatMap(m => m.linkedTpIds)])];
      const derived = deriveMappingAtpIds(unit.linkedTpIds, atp, tp);
      issues.push(...derived.issues);
      unit.linkedAtpItemIds = [...new Set([...(moved ? unit.linkedAtpItemIds.filter(id => !material!.linkedAtpItemIds.includes(id)) : replaced ? unit.linkedAtpItemIds.filter(id=>!original!.linkedAtpItemIds.includes(id) || derived.atpItemIds.includes(id)) : unit.linkedAtpItemIds), ...derived.atpItemIds])];
    }
    const historyAfter = action.after || JSON.stringify([...action.linkedTpIds].sort());
    const reviewedMaterialId = action.type === 'ADD_MATERIAL' ? `alignment-${action.id}` : action.targetMaterialId;
    const reviewedMaterial = target.materials.find(m => m.id === reviewedMaterialId);
    const previousUnit=units.find(u=>u.id===target.id),previousMaterial=previousUnit?.materials.find(m=>m.id===reviewedMaterialId);
    const relationChanged=previousMaterial && reviewedMaterial && JSON.stringify([previousMaterial.linkedTpIds,previousMaterial.linkedAtpItemIds])!==JSON.stringify([reviewedMaterial.linkedTpIds,reviewedMaterial.linkedAtpItemIds]);
    if (relationChanged || !target.actionHistory?.some(r => (!scoped||r.reviewedUnitTitle===target.title) && !target.actionHistory?.some(h=>h.undoOf===r.id) && r.materialId === reviewedMaterialId && r.before === (action.before || '') && r.after === historyAfter && r.kind === mappingActionKind(action, units))) {
      target.actionHistory = [...(target.actionHistory || []), { id: `action-${action.id}-${target.actionHistory?.length || 0}`, at: new Date().toISOString(), kind: mappingActionKind(action, units), approval:recordApproval, ...authority(action), unitId: target.id, materialId: reviewedMaterialId, before: action.before || '', after: historyAfter, reason: action.reason,
        ...(reviewedMaterial ? { reviewedTitle: reviewedMaterial.title, reviewedTpIds: [...action.linkedTpIds], reviewedTpFingerprint: reviewedTpFingerprint(action.linkedTpIds, tp) } : {}) }];
      if (action.type==='LINK_TP' && previousUnit && previousMaterial && reviewedMaterial) Object.assign(target.actionHistory.at(-1)!, {
        beforeLinks:{materialTpIds:[...previousMaterial.linkedTpIds],materialAtpIds:[...previousMaterial.linkedAtpItemIds],unitTpIds:[...previousUnit.linkedTpIds],unitAtpIds:[...previousUnit.linkedAtpItemIds]},
        afterLinks:{materialTpIds:[...reviewedMaterial.linkedTpIds],materialAtpIds:[...reviewedMaterial.linkedAtpItemIds],unitTpIds:[...target.linkedTpIds],unitAtpIds:[...target.linkedAtpItemIds]},
      });
    }
  }
  const before = mappingCoverage(units, atp, tp), coverage = mappingCoverage(next, atp, tp);
  if (!coverage.isValid) issues.push(...coverage.issues);
  for (const gap of coverage.materialCoverageGaps) {
    const previous = before.materialCoverageGaps.find(g => g.unitId === gap.unitId);
    if (gap.tpIds.some(id => !previous?.tpIds.includes(id)) || gap.atpItemIds.some(id => !previous?.atpItemIds.includes(id))) {
      fail(`SOURCE_LINEAGE_MISSING: perubahan menambah gap dukungan materi pada Bab '${gap.unitId}'.`);
    }
  }
  const explicitTeacherReplacement=approval==='TEACHER' && actions.length>0 && actions.every(action=>action.type==='LINK_TP'&&action.replaceTpIds);
  if (!explicitTeacherReplacement && (coverage.uncoveredTpIds.some(id => !before.uncoveredTpIds.includes(id)) || coverage.unmappedAtpIds.some(id => !before.unmappedAtpIds.includes(id)))) fail('COVERAGE_REGRESSION: perubahan menghilangkan cakupan canonical.');
  return issues.length ? { success: false, issues: [...new Set(issues)] } : { success: true, issues: [], nextUnits: next, rollbackUnits: structuredClone(units), coverage };
}
