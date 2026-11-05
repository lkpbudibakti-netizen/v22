import { CANONICAL_MERDEKA_TP_CODE_REGEX } from './tpCodeContract';
export { deriveScopeCode, generateSemanticTPCode } from './tpCodeContract';
import {
  CPData,
  CPAnalysisData,
  TPData,
  TPItem,
  ATPData,
  ATPItem,
  AssessmentCriterion,
  K13Analysis,
  WorkflowCompletionStatus,
  ActiveContext,
  AcademicSetting,
  normalizeCPVerificationStatus,
} from '../types';
import { checkTPSemanticFidelity } from './tpSemanticFidelity';
import { checkATPSemanticFidelity } from './atpSemanticFidelity';

export interface CPValidationDetails {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
}

/**
 * Validasi mendalam untuk status workflow CPData
 */
export function validateCPDataWorkflow(
  cp: CPData,
  context?: Partial<ActiveContext> | Partial<AcademicSetting>
): CPValidationDetails {
  const issues: string[] = [];

  const hasDesc = !!(cp.generalDescription && cp.generalDescription.trim().length >= 10);
  const hasElements = !!(cp.elements && cp.elements.length > 0);

  if (!hasDesc && !hasElements) {
    return {
      status: 'BELUM_DIMULAI',
      isSiap: false,
      issues: ['Deskripsi CP umum dan rincian elemen CP masih kosong.'],
    };
  }

  // Check element validity
  if (cp.elements && cp.elements.length > 0) {
    const seenElementIds = new Set<string>();
    for (let i = 0; i < cp.elements.length; i++) {
      const el = cp.elements[i];
      if (!el.id || typeof el.id !== 'string' || !el.id.trim()) {
        issues.push(`Elemen ke-${i + 1} tidak memiliki ID elemen yang valid.`);
      } else {
        const trimmedId = el.id.trim();
        if (seenElementIds.has(trimmedId)) {
          issues.push(`Elemen "${el.name || i + 1}" memiliki ID duplikat: ${trimmedId}.`);
        } else {
          seenElementIds.add(trimmedId);
        }
      }
      if (!el.name || !el.name.trim()) {
        issues.push(`Elemen ke-${i + 1} tidak memiliki nama elemen.`);
      }
      if (!el.content || !el.content.trim()) {
        issues.push(`Elemen "${el.name || i + 1}" tidak memiliki uraian konten.`);
      }
    }
  }

  // Check source availability & verification status
  if (!cp.source) {
    issues.push('Sumber rujukan CP belum diset.');
  } else {
    const status = normalizeCPVerificationStatus(cp.source.verificationStatus);
    if (status === 'SUPERSEDED') {
      issues.push('Sumber CP yang digunakan telah kedaluwarsa/digantikan (SUPERSEDED).');
    } else if (status === 'VERSION_CONFLICT') {
      issues.push('Terjadi konflik versi CP (AMBIGUOUS). Spesifikasikan tahun ajaran/regulasi.');
    }
  }

  // Check context match if context is provided
  if (context) {
    if (context.subject && cp.source?.title) {
      // Basic sanity check
    }
  }

  if (issues.length > 0) {
    const isDraft = hasDesc || hasElements;
    return {
      status: isDraft ? 'PERLU_DILENGKAPI' : 'BELUM_DIMULAI',
      isSiap: false,
      issues,
    };
  }

  return {
    status: 'SIAP',
    isSiap: true,
    issues: [],
  };
}

export interface CPAnalysisValidationDetails {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
}

/**
 * Validasi mendalam untuk status workflow CPAnalysisData
 */
export function validateCPAnalysisDataWorkflow(
  cpAnalysis?: CPAnalysisData,
  cp?: CPData
): CPAnalysisValidationDetails {
  const issues: string[] = [];

  if (!cpAnalysis || !cpAnalysis.items || cpAnalysis.items.length === 0) {
    return {
      status: 'BELUM_DIMULAI',
      isSiap: false,
      issues: ['Analisis CP belum memiliki baris bedah kompetensi.'],
    };
  }

  // Canonical CP dependency: CP must be provided
  if (!cp) {
    issues.push('Capaian Pembelajaran (CP) rujukan belum tersedia.');
  } else {
    const cpValidation = validateCPDataWorkflow(cp);
    if (!cpValidation.isSiap) {
      issues.push('Capaian Pembelajaran (CP) rujukan belum memenuhi status SIAP.');
    }

    // cpAnalysis.cpId wajib sama dengan cp.id
    if (!cpAnalysis.cpId || cpAnalysis.cpId !== cp.id) {
      issues.push(`ID CP rujukan pada analisis (${cpAnalysis.cpId || 'kosong'}) tidak sesuai dengan ID CP (${cp.id}).`);
    }

    // Jika cp.updatedAt tersedia, basedOnCpUpdatedAt wajib tersedia
    if (cp.updatedAt && !cpAnalysis.basedOnCpUpdatedAt) {
      issues.push('Timestamp rujukan CP (basedOnCpUpdatedAt) belum tercatat.');
    }
  }

  // Check if CP version changed or review needed
  if (cpAnalysis.needsReview) {
    issues.push(
      cpAnalysis.reviewReason ||
        'Versi CP sumber telah diperbarui. Analisis CP perlu ditinjau ulang.'
    );
  }

  const validCanonicalElementIds = new Set<string>(
    (cp?.elements || []).map((el) => (el.id ? el.id.trim() : '')).filter(Boolean)
  );
  const referencedElementIds = new Set<string>();
  const seenItemIds = new Set<string>();

  // Check items completeness
  for (let i = 0; i < cpAnalysis.items.length; i++) {
    const item = cpAnalysis.items[i];

    // Setiap CPAnalysisItem wajib mempunyai id non-empty dan unik
    if (!item.id || typeof item.id !== 'string' || !item.id.trim()) {
      issues.push(`Baris analisis ke-${i + 1} tidak memiliki ID yang valid.`);
    } else {
      const trimmedItemId = item.id.trim();
      if (seenItemIds.has(trimmedItemId)) {
        issues.push(`Baris analisis ke-${i + 1} memiliki ID duplikat: ${trimmedItemId}.`);
      } else {
        seenItemIds.add(trimmedItemId);
      }
    }

    // Setiap item wajib mempunyai elementId
    if (!item.elementId || typeof item.elementId !== 'string' || !item.elementId.trim()) {
      issues.push(`Baris analisis ke-${i + 1} ("${item.elementName || 'Tanpa Nama'}") belum memilih elemen CP rujukan (elementId kosong).`);
    } else {
      const trimmedElemId = item.elementId.trim();
      if (cp && cp.elements && cp.elements.length > 0) {
        if (!validCanonicalElementIds.has(trimmedElemId)) {
          issues.push(`Baris analisis ke-${i + 1} merujuk ke ID elemen yang tidak ada pada CP rujukan: "${trimmedElemId}".`);
        } else {
          referencedElementIds.add(trimmedElemId);
          const canonicalElement = cp.elements.find((el) => el.id && el.id.trim() === trimmedElemId);
          if (canonicalElement) {
            const itemElemName = (item.elementName || '').trim();
            const canonElemName = (canonicalElement.name || '').trim();
            if (itemElemName !== canonElemName) {
              issues.push(
                `Nama elemen pada baris ke-${i + 1} ("${itemElemName}") tidak sesuai dengan nama elemen CP canonical ("${canonElemName}").`
              );
            }
            const itemCpText = (item.cpText || '').trim();
            const canonCpText = (canonicalElement.content || '').trim();
            if (itemCpText !== canonCpText) {
              issues.push(
                `Teks CP pada baris ke-${i + 1} tidak sesuai dengan isi elemen CP canonical "${canonElemName}".`
              );
            }
          }
        }
      } else {
        referencedElementIds.add(trimmedElemId);
      }
    }

    if (!item.elementName || !item.elementName.trim()) {
      issues.push(`Baris analisis ke-${i + 1} belum memiliki nama elemen.`);
    }
    if (!item.cpCompetence || !item.cpCompetence.trim()) {
      issues.push(`Baris "${item.elementName || i + 1}" belum mengisi Kata Kerja Operasional (Kompetensi).`);
    }
    if (!item.materialScope || !item.materialScope.trim()) {
      issues.push(`Baris "${item.elementName || i + 1}" belum mengisi Lingkup Materi Inti.`);
    }
  }

  // Setiap elemen CP canonical harus direferensikan minimal satu AnalysisItem
  if (cp && cp.elements && cp.elements.length > 0) {
    for (const elem of cp.elements) {
      if (elem.id && !referencedElementIds.has(elem.id.trim())) {
        issues.push(`Elemen CP canonical "${elem.name}" (ID: ${elem.id}) belum dianalisis oleh butir Analisis CP mana pun.`);
      }
    }
  }

  // Check if source CP is outdated
  if (cp && cpAnalysis.basedOnCpUpdatedAt && cp.updatedAt) {
    const cpTime = new Date(cp.updatedAt).getTime();
    const anaTime = new Date(cpAnalysis.basedOnCpUpdatedAt).getTime();
    if (cpTime > anaTime + 1000) {
      issues.push('Teks CP telah diperbarui sejak analisis ini dibuat. Mohon sesuaikan analisis.');
    }
  }

  if (issues.length > 0) {
    return {
      status: 'PERLU_DILENGKAPI',
      isSiap: false,
      issues,
    };
  }

  return {
    status: 'SIAP',
    isSiap: true,
    issues: [],
  };
}

export interface TPValidationDetails {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
}

export type PhaseCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

export function normalizePhaseCode(value?: string | null): PhaseCode | '' {
  const normalized = (value || '').trim().toUpperCase().replace(/^FASE\s+/, '');
  return ['A', 'B', 'C', 'D', 'E', 'F'].includes(normalized) ? (normalized as PhaseCode) : '';
}

function formatPhase(code: string): string {
  return code ? `Fase ${code}` : 'Fase belum ditentukan';
}

export type SemanticChangeType = 'NONE' | 'NON_SUBSTANTIVE' | 'SUBSTANTIVE';

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => normalizeText(item)).filter(Boolean).sort() : [];
}

function pedagogicalCPFingerprint(cp?: CPData | null): string {
  if (!cp) return '';
  return stableStringify({
    academicSettingId: cp.academicSettingId,
    cpId: cp.cpId,
    cpVersion: cp.cpVersion,
    regulationIds: normalizeStringArray(cp.regulationIds),
    regulationSourceId: cp.regulationSourceId,
    generalDescription: normalizeText(cp.generalDescription),
    source: cp.source ? {
      id: cp.source.id,
      title: normalizeText(cp.source.title),
      institution: normalizeText(cp.source.institution),
      documentYear: normalizeText(cp.source.documentYear),
      page: normalizeText(cp.source.page),
      regulationId: cp.source.regulationId,
      regulationIds: normalizeStringArray(cp.source.regulationIds),
      versionCode: cp.source.versionCode,
      verificationStatus: normalizeCPVerificationStatus(cp.source.verificationStatus),
    } : null,
    elements: (cp.elements || []).map((element) => ({
      id: element.id,
      name: normalizeText(element.name),
      content: normalizeText(element.content),
    })),
  });
}

function pedagogicalCPAnalysisFingerprint(analysis?: CPAnalysisData | null): string {
  if (!analysis) return '';
  return stableStringify({
    academicSettingId: analysis.academicSettingId,
    cpId: analysis.cpId,
    cpSourceId: analysis.cpSourceId,
    cpRegulationIds: normalizeStringArray(analysis.cpRegulationIds),
    cpVersion: analysis.cpVersion,
    academicYear: analysis.academicYear,
    subjectCode: analysis.subjectCode,
    phase: normalizePhaseCode(analysis.phase) || normalizeText(analysis.phase),
    generalSummary: normalizeText(analysis.generalSummary),
    sourceCPVersion: analysis.sourceCPVersion,
    basedOnCpUpdatedAt: analysis.basedOnCpUpdatedAt,
    items: (analysis.items || []).map((item) => ({
      id: item.id,
      elementId: item.elementId,
      elementName: normalizeText(item.elementName),
      cpText: normalizeText(item.cpText),
      cpCompetence: normalizeText(item.cpCompetence),
      materialScope: normalizeText(item.materialScope),
      meaningfulUnderstanding: normalizeText(item.meaningfulUnderstanding),
      suggestedTp: normalizeText(item.suggestedTp),
      order: item.order,
    })),
  });
}

function pedagogicalTPFingerprint(tp?: TPData | null): string {
  if (!tp) return '';
  return stableStringify({
    academicSettingId: tp.academicSettingId,
    cpId: tp.cpId,
    cpAnalysisId: tp.cpAnalysisId,
    academicYear: tp.academicYear,
    subjectCode: tp.subjectCode,
    phase: normalizePhaseCode(tp.phase) || normalizeText(tp.phase),
    items: (tp.items || []).map((item) => ({
      id: item.id,
      code: normalizeText(item.code),
      statement: normalizeText(item.statement || item.description),
      competence: normalizeText(item.competence || (item as any).competency),
      contentScope: normalizeText(item.contentScope),
      materialScope: normalizeText((item as any).materialScope),
      order: item.order ?? item.sequence ?? null,
      p3Dimensions: normalizeStringArray(item.p3Dimensions),
      graduateProfileDimensions: normalizeStringArray(item.graduateProfileDimensions),
    })),
  });
}

function pedagogicalATPFingerprint(atp?: ATPData | null): string {
  if (!atp) return '';
  return stableStringify({
    academicSettingId: atp.academicSettingId,
    tpId: atp.tpId,
    tpDataId: atp.tpDataId,
    academicYear: atp.academicYear,
    subjectCode: atp.subjectCode,
    phase: normalizePhaseCode(atp.phase) || normalizeText(atp.phase),
    rationale: normalizeText(atp.rationale),
    items: (atp.items || []).map((item) => ({
      id: item.id,
      stepNumber: item.stepNumber ?? item.sequence ?? null,
      tpId: item.tpId,
      tpCode: normalizeText(item.tpCode),
      tpStatement: normalizeText(item.tpStatement),
      focus: normalizeText(item.focus),
      linkedTpIds: normalizeStringArray(item.linkedTpIds),
      materialScope: normalizeText(item.materialScope),
      jp: item.jp ?? item.allocatedJP ?? null,
      assessmentPlan: normalizeText(item.assessmentPlan),
      resources: normalizeText(item.resources),
      p3Dimensions: normalizeStringArray(item.p3Dimensions),
      graduateProfileDimensions: normalizeStringArray(item.graduateProfileDimensions),
    })),
  });
}

function pedagogicalCriterionFingerprint(criteria?: AssessmentCriterion[] | null): string {
  return stableStringify((criteria || []).map((criterion) => ({
    id: criterion.id,
    academicSettingId: criterion.academicSettingId,
    tpId: criterion.tpId,
    description: normalizeText(criterion.description),
    approach: criterion.approach,
    passingThreshold: criterion.passingThreshold ?? null,
    indicators: normalizeStringArray(criterion.indicators),
    levels: stableStringify(criterion.levels || []),
    kompleksitas: criterion.kompleksitas ?? null,
    dayaDukung: criterion.dayaDukung ?? null,
    intake: criterion.intake ?? null,
  })));
}

function pedagogicalTPItemFingerprint(item?: TPItem | null): string {
  if (!item) return '';
  return stableStringify({
    id: item.id,
    code: normalizeText(item.code),
    statement: normalizeText(item.statement || item.description),
    competence: normalizeText(item.competence || (item as any).competency),
    contentScope: normalizeText(item.contentScope),
    materialScope: normalizeText((item as any).materialScope),
    order: item.order ?? item.sequence ?? null,
    p3Dimensions: normalizeStringArray(item.p3Dimensions),
    graduateProfileDimensions: normalizeStringArray(item.graduateProfileDimensions),
  });
}

function pedagogicalSingleCriterionFingerprint(criterion?: AssessmentCriterion | null): string {
  if (!criterion) return '';
  return stableStringify({
    id: criterion.id,
    academicSettingId: criterion.academicSettingId,
    tpId: criterion.tpId,
    description: normalizeText(criterion.description),
    approach: criterion.approach,
    criterionMode: criterion.criterionMode,
    method: criterion.method,
    indicators: normalizeStringArray(criterion.indicators),
    levels: stableStringify(criterion.levels || []),
    passingThreshold: criterion.passingThreshold ?? null,
    kompleksitas: criterion.kompleksitas ?? null,
    dayaDukung: criterion.dayaDukung ?? null,
    intake: criterion.intake ?? null,
    notes: normalizeText(criterion.notes),
  });
}

export function classifyCPChange(oldCP?: CPData | null, newCP?: CPData | null): SemanticChangeType {
  if (!oldCP && !newCP) return 'NONE';
  if (pedagogicalCPFingerprint(oldCP) !== pedagogicalCPFingerprint(newCP)) return 'SUBSTANTIVE';
  return stableStringify(oldCP || null) === stableStringify(newCP || null) ? 'NONE' : 'NON_SUBSTANTIVE';
}

export function classifyCPAnalysisChange(
  oldAnalysis?: CPAnalysisData | null,
  newAnalysis?: CPAnalysisData | null
): SemanticChangeType {
  if (!oldAnalysis && !newAnalysis) return 'NONE';
  if (pedagogicalCPAnalysisFingerprint(oldAnalysis) !== pedagogicalCPAnalysisFingerprint(newAnalysis)) return 'SUBSTANTIVE';
  return stableStringify(oldAnalysis || null) === stableStringify(newAnalysis || null) ? 'NONE' : 'NON_SUBSTANTIVE';
}

export function classifyTPChange(oldTP?: TPData | null, newTP?: TPData | null): SemanticChangeType {
  if (!oldTP && !newTP) return 'NONE';
  if (pedagogicalTPFingerprint(oldTP) !== pedagogicalTPFingerprint(newTP)) return 'SUBSTANTIVE';
  return stableStringify(oldTP || null) === stableStringify(newTP || null) ? 'NONE' : 'NON_SUBSTANTIVE';
}

export function classifyATPChange(oldATP?: ATPData | null, newATP?: ATPData | null): SemanticChangeType {
  if (!oldATP && !newATP) return 'NONE';
  if (pedagogicalATPFingerprint(oldATP) !== pedagogicalATPFingerprint(newATP)) return 'SUBSTANTIVE';
  return stableStringify(oldATP || null) === stableStringify(newATP || null) ? 'NONE' : 'NON_SUBSTANTIVE';
}

export function classifyAssessmentCriteriaChange(
  oldCriteria?: AssessmentCriterion[] | null,
  newCriteria?: AssessmentCriterion[] | null
): SemanticChangeType {
  if ((!oldCriteria || oldCriteria.length === 0) && (!newCriteria || newCriteria.length === 0)) return 'NONE';
  if (pedagogicalCriterionFingerprint(oldCriteria) !== pedagogicalCriterionFingerprint(newCriteria)) return 'SUBSTANTIVE';
  return stableStringify(oldCriteria || []) === stableStringify(newCriteria || []) ? 'NONE' : 'NON_SUBSTANTIVE';
}

export function getChangedTPItemIds(oldTP?: TPData | null, newTP?: TPData | null): Set<string> {
  const changed = new Set<string>();
  const oldMap = new Map((oldTP?.items || []).map((item) => [item.id, item]));
  const newMap = new Map((newTP?.items || []).map((item) => [item.id, item]));
  oldMap.forEach((oldItem, id) => {
    const newItem = newMap.get(id);
    if (!newItem || pedagogicalTPItemFingerprint(oldItem) !== pedagogicalTPItemFingerprint(newItem)) {
      changed.add(id);
    }
  });
  newMap.forEach((newItem, id) => {
    const oldItem = oldMap.get(id);
    if (!oldItem || pedagogicalTPItemFingerprint(oldItem) !== pedagogicalTPItemFingerprint(newItem)) {
      changed.add(id);
    }
  });
  return changed;
}

export function getChangedAssessmentCriterionIds(
  oldCriteria?: AssessmentCriterion[] | null,
  newCriteria?: AssessmentCriterion[] | null
): Set<string> {
  const changed = new Set<string>();
  const oldMap = new Map((oldCriteria || []).map((criterion) => [criterion.id, criterion]));
  const newMap = new Map((newCriteria || []).map((criterion) => [criterion.id, criterion]));
  oldMap.forEach((oldCriterion, id) => {
    const newCriterion = newMap.get(id);
    if (!newCriterion || pedagogicalSingleCriterionFingerprint(oldCriterion) !== pedagogicalSingleCriterionFingerprint(newCriterion)) {
      changed.add(id);
    }
  });
  newMap.forEach((newCriterion, id) => {
    const oldCriterion = oldMap.get(id);
    if (!oldCriterion || pedagogicalSingleCriterionFingerprint(oldCriterion) !== pedagogicalSingleCriterionFingerprint(newCriterion)) {
      changed.add(id);
    }
  });
  return changed;
}

/**
 * Validasi mendalam untuk status workflow TPData (Tujuan Pembelajaran)
 */
export function validateTPDataWorkflow(
  tp?: TPData,
  cp?: CPData,
  cpAnalysis?: CPAnalysisData,
  context?: Partial<ActiveContext> | Partial<AcademicSetting>
): TPValidationDetails {
  const issues: string[] = [];

  if (!tp || !tp.items || tp.items.length === 0) {
    return {
      status: 'BELUM_DIMULAI',
      isSiap: false,
      issues: ['Daftar Tujuan Pembelajaran (TP) belum dirumuskan.'],
    };
  }

  // Check essential provenance fields
  if (!tp.academicSettingId) {
    issues.push('TP belum terikat pada Academic Setting (academicSettingId).');
  }
  if (tp.cpId && cp && cp.id && tp.cpId !== cp.id) {
    issues.push(`ID CP pada TP (${tp.cpId}) tidak sesuai dengan CP rujukan (${cp.id}).`);
  }

  // Check if review is flagged
  if (tp.needsReview) {
    issues.push(
      tp.reviewReason ||
        'Tujuan Pembelajaran memerlukan peninjauan ulang karena data acuan (CP / Analisis CP) mengalami perubahan.'
    );
  }

  // Check CP source validity if CP is provided
  if (cp) {
    const cpStatus = normalizeCPVerificationStatus(
      cp.source?.verificationStatus || (cp as { verificationStatus?: any }).verificationStatus
    );
    if (['SUPERSEDED', 'VERSION_CONFLICT', 'AMBIGUOUS', 'UNRESOLVED'].includes(cpStatus)) {
      issues.push(`CP rujukan berstatus ${cpStatus} dan tidak valid untuk perumusan TP.`);
    }

    if (cp.updatedAt && tp.basedOnCpUpdatedAt) {
      const cpTime = new Date(cp.updatedAt).getTime();
      const tpCpTime = new Date(tp.basedOnCpUpdatedAt).getTime();
      if (cpTime > tpCpTime + 1000) {
        issues.push('Capaian Pembelajaran (CP) telah diperbarui sejak TP ini dirumuskan.');
      }
    }
  }

  // Check CP Analysis validity
  if (!cpAnalysis) {
    if (tp.items && tp.items.length > 0) {
      issues.push('Analisis CP rujukan belum tersedia.');
    }
  } else {
    const cpAnalysisValidation = validateCPAnalysisDataWorkflow(cpAnalysis, cp);
    if (!cpAnalysisValidation.isSiap) {
      issues.push('Analisis CP rujukan belum memenuhi status SIAP.');
    }
    if (cpAnalysis.needsReview) {
      issues.push('Analisis CP rujukan memerlukan peninjauan ulang.');
    }
    if (cpAnalysis.updatedAt && tp.basedOnAnalysisUpdatedAt) {
      const anaTime = new Date(cpAnalysis.updatedAt).getTime();
      const tpAnaTime = new Date(tp.basedOnAnalysisUpdatedAt).getTime();
      if (anaTime > tpAnaTime + 1000) {
        issues.push('Analisis CP telah diperbarui sejak TP ini dirumuskan.');
      }
    }
    if (tp.cpAnalysisId && cpAnalysis.id && tp.cpAnalysisId !== cpAnalysis.id) {
      issues.push('ID Analisis CP pada TP tidak sesuai dengan Analisis CP rujukan.');
    }
  }

  // Check Context / AcademicSetting consistency if context is provided
  if (context) {
    const contextSubject = (context as any).subjectCode || context.subject;
    if (contextSubject && tp.subjectCode && tp.subjectCode !== contextSubject) {
      issues.push(`Mata pelajaran TP (${tp.subjectCode}) tidak sesuai dengan konteks (${contextSubject}).`);
    }
    if (context.academicYear && tp.academicYear && tp.academicYear !== context.academicYear) {
      issues.push(`Tahun ajaran TP (${tp.academicYear}) tidak sesuai dengan konteks (${context.academicYear}).`);
    }
    const tpPhaseCode = normalizePhaseCode(tp.phase);
    const contextPhaseCode = normalizePhaseCode(context.phase);
    if (context.phase && tp.phase && tpPhaseCode !== contextPhaseCode) {
      issues.push(`Fase TP (${formatPhase(tpPhaseCode)}) tidak sesuai dengan konteks (${formatPhase(contextPhaseCode)}).`);
    }

    const level =
      context.level ||
      (context.grade
        ? ['Kelas 1', 'Kelas 2', 'Kelas 3', 'Kelas 4', 'Kelas 5', 'Kelas 6', '1', '2', '3', '4', '5', '6'].some((g) =>
            String(context.grade).includes(g)
          )
          ? 'SD'
          : ['Kelas 7', 'Kelas 8', 'Kelas 9', '7', '8', '9'].some((g) => String(context.grade).includes(g))
          ? 'SMP'
          : 'SMA'
        : undefined);

    if (level && context.phase) {
      const phaseCode = normalizePhaseCode(context.phase);
      if (level === 'SD' && !['A', 'B', 'C'].includes(phaseCode)) {
        issues.push(`${formatPhase(phaseCode)} tidak sesuai untuk jenjang SD (harus Fase A, B, atau C).`);
      } else if (level === 'SMP' && phaseCode !== 'D') {
        issues.push(`${formatPhase(phaseCode)} tidak sesuai untuk jenjang SMP (harus Fase D).`);
      } else if (level === 'SMA' && !['E', 'F'].includes(phaseCode)) {
        issues.push(`${formatPhase(phaseCode)} tidak sesuai untuk jenjang SMA (harus Fase E atau F).`);
      }
    }
  }

  // Check items completeness, stable ID uniqueness & CP Analysis coverage
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  const referencedAnalysisItemIds = new Set<string>();

  const analysisItemMap = new Map<string, { id: string; elementId?: string; elementName?: string }>();
  if (cpAnalysis?.items) {
    cpAnalysis.items.forEach((item) => {
      if (item.id) {
        analysisItemMap.set(item.id, {
          id: item.id,
          elementId: item.elementId,
          elementName: (item.elementName || '').trim().toLowerCase(),
        });
      }
    });
  }

  for (let i = 0; i < tp.items.length; i++) {
    const item = tp.items[i];
    const stmt = item.statement || item.description || '';
    if (!stmt.trim()) {
      issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) belum memiliki rumusan kalimat TP.`);
    }
    if (!item.id) {
      issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) belum memiliki Stable ID.`);
    } else {
      if (seenIds.has(item.id)) {
        issues.push(`Terdeteksi duplikasi Stable ID (${item.id}) pada butir TP.`);
      }
      seenIds.add(item.id);
    }

    if (!item.code || !item.code.trim()) {
      issues.push(`Butir TP ke-${i + 1} belum memiliki kode TP.`);
    } else {
      const normalizedCode = item.code.trim().toUpperCase();
      const tpCodeRegex = CANONICAL_MERDEKA_TP_CODE_REGEX;
      if (!tpCodeRegex.test(normalizedCode)) {
        issues.push(`Format Kode TP "${item.code}" tidak sah! Format harus sesuai pola E1-PGD-01 (huruf E kapital, angka, singkatan materi kapital 2-5 karakter, dan nomor urut 2 digit).`);
      } else if (seenCodes.has(normalizedCode)) {
        issues.push(`Terdeteksi duplikasi Kode TP (${item.code}) pada daftar TP.`);
      }
      seenCodes.add(normalizedCode);
    }

    // Deep validation against CP Analysis items if available
    if (cpAnalysis && cpAnalysis.items && cpAnalysis.items.length > 0) {
      // 1. Setiap TP harus memiliki competence
      const comp = item.competence || (item as any).competency || '';
      if (!comp.trim()) {
        issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) belum mengisi Kata Kerja Operasional (Kompetensi).`);
      }

      // 2. Setiap TP harus memiliki contentScope
      const scope = item.contentScope || (item as any).materialScope || '';
      if (!scope.trim()) {
        issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) belum mengisi Lingkup Materi.`);
      }

      // 3. Setiap TP harus memiliki cpAnalysisItemIds tepat 1 ID (ATOMIC TP CONTRACT)
      const analysisIds = (Array.isArray(item.cpAnalysisItemIds) && item.cpAnalysisItemIds.length > 0)
        ? item.cpAnalysisItemIds
        : (item.cpAnalysisId ? [item.cpAnalysisId] : []);
      if (analysisIds.length === 0) {
        issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) belum menautkan butir Analisis CP.`);
      } else if (analysisIds.length > 1) {
        issues.push(
          `Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) menautkan lebih dari satu butir Analisis CP (${analysisIds.length} butir). Sesuai kontrak TP atomik, satu TP hanya boleh merujuk tepat satu butir Analisis CP.`
        );
        for (const anaId of analysisIds) {
          const matched = analysisItemMap.get(anaId);
          if (!matched) {
            issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) menautkan ID Analisis CP (${anaId}) yang tidak ditemukan.`);
          } else {
            referencedAnalysisItemIds.add(anaId);
          }
        }
      } else {
        const anaId = analysisIds[0];
        const matched = analysisItemMap.get(anaId);
        if (!matched) {
          issues.push(`Butir TP ke-${i + 1} (${item.code || 'Tanpa Kode'}) menautkan ID Analisis CP (${anaId}) yang tidak ditemukan.`);
        } else {
          referencedAnalysisItemIds.add(anaId);
        }
      }
    }
  }

  // 6. Setiap CPAnalysisItem harus direferensikan minimal oleh satu TP
  if (cpAnalysis && cpAnalysis.items && cpAnalysis.items.length > 0) {
    for (const anaItem of cpAnalysis.items) {
      if (anaItem.id && !referencedAnalysisItemIds.has(anaItem.id)) {
        issues.push(`Butir Analisis CP "${anaItem.elementName || 'Elemen'}" (${anaItem.cpCompetence || 'Analisis'}) belum ditautkan oleh TP manapun.`);
      }
    }

    const semanticFidelity = checkTPSemanticFidelity(tp.items, cpAnalysis.items);
    if (!semanticFidelity.isValid) {
      semanticFidelity.issues.forEach((iss) => {
        if (!issues.includes(iss)) {
          issues.push(iss);
        }
      });
    }
  }

  if (issues.length > 0) {
    return {
      status: 'PERLU_DILENGKAPI',
      isSiap: false,
      issues,
    };
  }

  return {
    status: 'SIAP',
    isSiap: true,
    issues: [],
  };
}

// ==========================================
// ATP REFERENCE VALIDATION & RESOLUTION
// ==========================================

export type ATPReferenceStatus =
  | 'RESOLVED_REFERENCE'
  | 'LEGACY_MIGRATED'
  | 'AMBIGUOUS_REFERENCE'
  | 'DANGLING_REFERENCE'
  | 'UNRESOLVED_REFERENCE';

export interface ATPReferenceResult {
  status: ATPReferenceStatus;
  canonicalTPItem?: TPItem;
  tpId?: string;
  issue?: string;
}

export interface ATPMultiReferenceResult {
  status: ATPReferenceStatus;
  canonicalTPItems: TPItem[];
  tpIds: string[];
  issues: string[];
  usedLegacyFallback: boolean;
  isValid: boolean;
}

/**
 * Canonical resolver for ATP Step to 1..n atomic TPItems.
 * 
 * Rules:
 * A. Canonical First:
 *    If atpItem.linkedTpIds is provided and non-empty:
 *    - Use linkedTpIds as canonical authority
 *    - Trim IDs, preserve order
 *    - Validate each ID against tpItems (TPData)
 *    - If ID not found -> issue dangling reference
 *    - If duplicate ID in the same step -> issue duplicate TP reference
 *    - STRICTLY NO fallback to tpId/tpCode/tpStatement if linkedTpIds is invalid
 * B. Legacy Fallback:
 *    Only if linkedTpIds is empty or not provided:
 *    - Use exact tpId if valid
 *    - If no tpId, use unique tpCode resolution
 *    - If no unique code, use unique tpStatement resolution
 *    - Preserve strict rules (no positional, no index, no first-match fallback, ambiguous remains ambiguous)
 * C. Same TP across different steps:
 *    Allowed and valid! Step 1 -> [A, KAR], Step 2 -> [B, KAR] is valid.
 */
export function resolveATPItemTPReferences(
  atpItem: ATPItem,
  tpItems: TPItem[] = []
): ATPMultiReferenceResult {
  const issues: string[] = [];

  // A. CANONICAL FIRST: If linkedTpIds is defined and non-empty
  if (Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0) {
    const rawIds = atpItem.linkedTpIds
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);

    if (rawIds.length === 0) {
      issues.push(`Langkah ATP ke-${atpItem.stepNumber || 1} memiliki linkedTpIds kosong.`);
      return {
        status: 'UNRESOLVED_REFERENCE',
        canonicalTPItems: [],
        tpIds: [],
        issues,
        usedLegacyFallback: false,
        isValid: false,
      };
    }

    // Check for duplicate TP IDs in the same step
    const seenIds = new Set<string>();
    let hasDuplicate = false;
    for (const id of rawIds) {
      if (seenIds.has(id)) {
        hasDuplicate = true;
      }
      seenIds.add(id);
    }

    if (hasDuplicate) {
      issues.push(
        `Langkah ATP ke-${atpItem.stepNumber || 1} memiliki duplikasi referensi TP dalam satu langkah (Duplicate TP Reference).`
      );
    }

    // Validate each ID against TPData (preserving order)
    const tpMap = new Map<string, TPItem>();
    tpItems.forEach((t) => tpMap.set(t.id, t));

    const matchedTPItems: TPItem[] = [];
    const danglingIds: string[] = [];

    for (const id of rawIds) {
      const tp = tpMap.get(id);
      if (tp) {
        matchedTPItems.push(tp);
      } else {
        danglingIds.push(id);
      }
    }

    if (danglingIds.length > 0) {
      issues.push(
        `TP dengan ID "${danglingIds.join(', ')}" pada langkah ke-${atpItem.stepNumber || 1} tidak ditemukan pada TP tersimpan (Dangling Reference).`
      );
    }

    const isValid = !hasDuplicate && danglingIds.length === 0 && matchedTPItems.length > 0;
    const status: ATPReferenceStatus = danglingIds.length > 0
      ? 'DANGLING_REFERENCE'
      : hasDuplicate
      ? 'AMBIGUOUS_REFERENCE'
      : 'RESOLVED_REFERENCE';

    return {
      status,
      canonicalTPItems: matchedTPItems,
      tpIds: rawIds,
      issues,
      usedLegacyFallback: false,
      isValid,
    };
  }

  // B. LEGACY FALLBACK: Only if linkedTpIds is empty / not provided
  const legacyRes = resolveATPItemTPReference(atpItem, tpItems);
  const canonicalTPItems = legacyRes.canonicalTPItem ? [legacyRes.canonicalTPItem] : [];
  const tpIds = legacyRes.tpId ? [legacyRes.tpId] : [];
  if (legacyRes.issue) {
    issues.push(legacyRes.issue);
  }

  const isValid =
    (legacyRes.status === 'RESOLVED_REFERENCE' || legacyRes.status === 'LEGACY_MIGRATED') &&
    canonicalTPItems.length > 0;

  return {
    status: legacyRes.status,
    canonicalTPItems,
    tpIds,
    issues,
    usedLegacyFallback: true,
    isValid,
  };
}

/**
 * Resolves reference from an ATPItem to a canonical TPItem in TPData.
 * Strictly adheres to V7 canonical matching:
 * 1. Match exact tpId
 * 2. Match unique tpCode (only if candidate count === 1)
 * 3. Match unique tpStatement (only if candidate count === 1)
 * 4. Strictly NO positional or index-based fallback
 * 5. Strictly NO first-match fallback
 */
export function resolveATPItemTPReference(
  atpItem: ATPItem,
  tpItems: TPItem[] = []
): ATPReferenceResult {
  // 1. If atpItem has a tpId
  if (atpItem.tpId && atpItem.tpId.trim()) {
    const match = tpItems.find((t) => t.id === atpItem.tpId?.trim());
    if (match) {
      return {
        status: 'RESOLVED_REFERENCE',
        canonicalTPItem: match,
        tpId: match.id,
      };
    } else {
      return {
        status: 'DANGLING_REFERENCE',
        tpId: atpItem.tpId,
        issue: `TP dengan ID "${atpItem.tpId}" pada langkah ke-${atpItem.stepNumber} tidak ditemukan pada TP tersimpan (Dangling Reference).`,
      };
    }
  }

  // 2. Legacy check: Evaluate candidates by code and statement
  const trimmedCode = atpItem.tpCode ? atpItem.tpCode.trim().toLowerCase() : '';
  const codeMatches = trimmedCode
    ? tpItems.filter((t) => t.code && t.code.trim().toLowerCase() === trimmedCode)
    : [];

  const normStatement = atpItem.tpStatement ? atpItem.tpStatement.trim().toLowerCase() : '';
  const statementMatches = normStatement
    ? tpItems.filter((t) => (t.statement || t.description || '').trim().toLowerCase() === normStatement)
    : [];

  // Check if either candidate set is ambiguous (> 1 match)
  if (codeMatches.length > 1) {
    return {
      status: 'AMBIGUOUS_REFERENCE',
      issue: `Kode TP "${atpItem.tpCode}" pada langkah ke-${atpItem.stepNumber} cocok dengan lebih dari 1 butir TP (Ambiguous Reference).`,
    };
  }
  if (statementMatches.length > 1) {
    return {
      status: 'AMBIGUOUS_REFERENCE',
      issue: `Kalimat TP "${atpItem.tpStatement}" pada langkah ke-${atpItem.stepNumber} cocok dengan lebih dari 1 butir TP (Ambiguous Reference).`,
    };
  }

  // If both code and statement matched exactly one, ensure they agree
  if (codeMatches.length === 1 && statementMatches.length === 1) {
    if (codeMatches[0].id === statementMatches[0].id) {
      return {
        status: 'LEGACY_MIGRATED',
        canonicalTPItem: codeMatches[0],
        tpId: codeMatches[0].id,
      };
    } else {
      return {
        status: 'AMBIGUOUS_REFERENCE',
        issue: `Kode TP "${atpItem.tpCode}" dan Kalimat TP pada langkah ke-${atpItem.stepNumber} merujuk pada dua butir TP yang berbeda (Contradictory / Ambiguous Reference).`,
      };
    }
  }

  // If unique code matched
  if (codeMatches.length === 1) {
    return {
      status: 'LEGACY_MIGRATED',
      canonicalTPItem: codeMatches[0],
      tpId: codeMatches[0].id,
    };
  }

  // If unique statement matched
  if (statementMatches.length === 1) {
    return {
      status: 'LEGACY_MIGRATED',
      canonicalTPItem: statementMatches[0],
      tpId: statementMatches[0].id,
    };
  }

  // 3. Unresolved reference
  return {
    status: 'UNRESOLVED_REFERENCE',
    issue: `Langkah ATP ke-${atpItem.stepNumber} (${atpItem.tpCode || 'Tanpa Kode'}) belum terhubung dengan Tujuan Pembelajaran (TP) manapun.`,
  };
}

/**
 * Validates ATP Data and its items against canonical TPData & AcademicSetting context.
 * Single authoritative validator for ATP workflow status.
 */
export function validateATPDataWorkflow(
  atp?: ATPData,
  tp?: TPData,
  academicSetting?: AcademicSetting,
  cp?: CPData,
  cpAnalysis?: CPAnalysisData
): {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
  details: ATPReferenceResult[];
  multiDetails?: ATPMultiReferenceResult[];
} {
  const issues: string[] = [];
  const details: ATPReferenceResult[] = [];
  const multiDetails: ATPMultiReferenceResult[] = [];

  if (!atp || !atp.items || atp.items.length === 0) {
    return {
      status: 'BELUM_DIMULAI',
      isSiap: false,
      issues: ['Matriks Alur Tujuan Pembelajaran (ATP) belum disusun.'],
      details,
      multiDetails,
    };
  }

  // 1. Canonical TP Runtime Readiness check
  if (!tp || !tp.items || tp.items.length === 0) {
    issues.push('Daftar Tujuan Pembelajaran (TP) acuan belum tersedia.');
  } else {
    // Deep runtime validation on TP
    const tpValidation = validateTPDataWorkflow(tp, cp, cpAnalysis, academicSetting);
    if (!tpValidation.isSiap) {
      tpValidation.issues.forEach((iss) => {
        if (!issues.includes(iss)) {
          issues.push(iss);
        }
      });
    }
    if (tp.workflowStatus !== 'SIAP') {
      issues.push(`Tujuan Pembelajaran (TP) acuan belum berstatus SIAP (status: ${tp.workflowStatus || 'BELUM_DIMULAI'}).`);
    }
    if (tp.needsReview) {
      issues.push(tp.reviewReason || 'Tujuan Pembelajaran (TP) acuan memerlukan peninjauan ulang.');
    }
  }

  // 2. Flag review check on ATP
  if (atp.needsReview) {
    issues.push(
      atp.reviewReason || 'Alur Tujuan Pembelajaran (ATP) memerlukan peninjauan ulang karena TP acuan telah diperbarui.'
    );
  }

  // 3. Workflow status check on ATP
  if (atp.workflowStatus !== 'SIAP') {
    if (atp.workflowStatus === 'DRAFT') {
      issues.push('Alur Tujuan Pembelajaran (ATP) berstatus DRAFT dan memerlukan konfirmasi guru.');
    } else {
      issues.push(`Alur Tujuan Pembelajaran (ATP) belum berstatus SIAP (status: ${atp.workflowStatus || 'BELUM_DIMULAI'}).`);
    }
  }

  // 4. Academic Setting check
  if (academicSetting && atp.academicSettingId && atp.academicSettingId !== academicSetting.id) {
    issues.push(`ATP terikat pada Academic Setting lain (${atp.academicSettingId}).`);
  }

  // 5. Provenance & Stale check against TPData
  if (tp?.id) {
    if (atp.tpId && atp.tpId !== tp.id) {
      issues.push(`ID TPData pada ATP (${atp.tpId}) tidak sesuai dengan TP rujukan (${tp.id}).`);
    }
    if (atp.tpDataId && atp.tpDataId !== tp.id) {
      issues.push(`ID TPData pada ATP (${atp.tpDataId}) tidak sesuai dengan TP rujukan (${tp.id}).`);
    }
    if (!atp.basedOnTpUpdatedAt) {
      issues.push('Lineage ATP belum mencatat waktu TP acuan saat dikonfirmasi.');
    } else if (tp.updatedAt) {
      const tpTime = new Date(tp.updatedAt).getTime();
      const atpTpTime = new Date(atp.basedOnTpUpdatedAt).getTime();
      if (tpTime > atpTpTime + 1000) {
        issues.push('TP acuan telah berubah sejak ATP dikonfirmasi.');
      }
    }
  }

  // 6. Items step ordering, non-empty focus & reference validation
  const tpItems = tp?.items || [];
  const seenStepNumbers = new Set<number>();
  const coveredTpIdSet = new Set<string>();

  for (let i = 0; i < atp.items.length; i++) {
    const item = atp.items[i];

    // Step number ordering
    if (!item.stepNumber || item.stepNumber <= 0) {
      issues.push(`Langkah ATP ke-${i + 1} memiliki nomor urut (stepNumber) yang tidak valid.`);
    } else if (seenStepNumbers.has(item.stepNumber)) {
      issues.push(`Langkah ATP ke-${i + 1} memiliki nomor urut duplikat (${item.stepNumber}).`);
    } else {
      seenStepNumbers.add(item.stepNumber);
    }

    // Step focus non-empty check
    if (!item.focus || !item.focus.trim()) {
      issues.push(`Langkah ATP ke-${item.stepNumber || i + 1} belum memiliki fokus langkah pembelajaran (focus non-empty).`);
    }

    // Canonical multi-reference resolution
    const multiRes = resolveATPItemTPReferences(item, tpItems);
    multiDetails.push(multiRes);

    details.push({
      status: multiRes.status,
      canonicalTPItem: multiRes.canonicalTPItems[0],
      tpId: multiRes.tpIds[0],
      issue: multiRes.issues[0],
    });

    if (!multiRes.isValid) {
      multiRes.issues.forEach((iss) => {
        if (!issues.includes(iss)) {
          issues.push(iss);
        }
      });
    } else {
      const semanticRes = checkATPSemanticFidelity(item.focus, multiRes.canonicalTPItems);
      if (!semanticRes.isValid) {
        issues.push(
          `ATP_SEMANTIC_FIDELITY: Langkah ATP ke-${item.stepNumber || i + 1} gagal kesesuaian fokus dengan TP canonical: ${semanticRes.reason}`
        );
      }
      // Record all linked TPs for coverage
      multiRes.canonicalTPItems.forEach((t) => coveredTpIdSet.add(t.id));
    }

    if (item.jp !== undefined && item.jp !== null && Number(item.jp) <= 0) {
      issues.push(`Langkah ATP ke-${item.stepNumber || i + 1} belum memiliki alokasi JP yang valid.`);
    }
  }

  // 7. TP Coverage check (MISSING_TP_REFERENCE)
  if (tpItems.length > 0) {
    for (const tpItem of tpItems) {
      if (!coveredTpIdSet.has(tpItem.id)) {
        issues.push(
          `MISSING_TP_REFERENCE: Tujuan Pembelajaran "${tpItem.code || tpItem.id}" (${(tpItem.statement || '').substring(0, 40)}...) belum dimasukkan ke dalam Alur Tujuan Pembelajaran (ATP).`
        );
      }
    }
  }

  if (issues.length > 0) {
    return {
      status: atp.workflowStatus === 'DRAFT' ? 'DRAFT' : 'PERLU_DILENGKAPI',
      isSiap: false,
      issues,
      details,
      multiDetails,
    };
  }

  return {
    status: 'SIAP',
    isSiap: true,
    issues: [],
    details,
    multiDetails,
  };
}

/**
 * Validates all ATP items against canonical TPData & AcademicSetting context.
 */
export function validateATPReferences(
  atp?: ATPData,
  tp?: TPData,
  academicSetting?: AcademicSetting,
  cp?: CPData,
  cpAnalysis?: CPAnalysisData
): {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
  details: ATPReferenceResult[];
  multiDetails?: ATPMultiReferenceResult[];
} {
  return validateATPDataWorkflow(atp, tp, academicSetting, cp, cpAnalysis);
}

/**
 * Automatically migrates legacy ATP items (populating tpId if unique match found).
 */
export function normalizeATPReferences(atp: ATPData, tp?: TPData): ATPData {
  if (!tp || !tp.items || tp.items.length === 0) return atp;

  const updatedItems = atp.items.map((item) => {
    // 1. Jika linkedTpIds sudah memiliki isi: pertahankan canonical linkedTpIds tersebut.
    // JANGAN menggantinya dari tpId. JANGAN membuat tpId = A sebagai canonical fake alias.
    if (Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0) {
      return item;
    }

    // 2. Jika linkedTpIds kosong / tidak tersedia:
    // Resolve via legacy resolver
    const res = resolveATPItemTPReference(item, tp.items);
    if ((res.status === 'RESOLVED_REFERENCE' || res.status === 'LEGACY_MIGRATED') && res.tpId) {
      return {
        ...item,
        linkedTpIds: [res.tpId],
        tpId: item.tpId || res.tpId,
        tpCode: res.canonicalTPItem?.code || item.tpCode,
        tpStatement: res.canonicalTPItem?.statement || item.tpStatement,
      };
    }

    return item;
  });

  return {
    ...atp,
    tpId: atp.tpId || tp.id,
    items: updatedItems,
  };
}

// ==========================================
// KKTP WORKFLOW & CANONICAL RESOLVER (AUDIT NO. 6)
// ==========================================

export interface CriterionReferenceResult {
  status:
    | 'RESOLVED_REFERENCE'
    | 'LEGACY_MIGRATED'
    | 'AMBIGUOUS_REFERENCE'
    | 'DANGLING_REFERENCE'
    | 'UNRESOLVED_REFERENCE';
  canonicalTPItem?: TPItem;
  tpId?: string;
  issue?: string;
}

/**
 * Resolves canonical TP or KD reference for an AssessmentCriterion.
 * Strictly adheres to:
 * - Exact tpId match
 * - If tpId is specified but not found in canonical TP list -> DANGLING_REFERENCE (no silent positional replacement)
 * - Unique legacy statement/code matching (only if tpId is empty)
 * - Ambiguous matches return AMBIGUOUS_REFERENCE (never silently choose first match)
 */
export function resolveCriterionTPReference(
  criterion: AssessmentCriterion,
  tpItems: TPItem[],
  k13Analysis?: K13Analysis
): CriterionReferenceResult {
  // 1. Kurikulum Merdeka Evaluation
  if (tpItems && tpItems.length > 0) {
    // Exact tpId reference
    if (criterion.tpId && criterion.tpId.trim()) {
      const trimmedId = criterion.tpId.trim();
      const matched = tpItems.find((t) => t.id === trimmedId);
      if (matched) {
        return {
          status: 'RESOLVED_REFERENCE',
          canonicalTPItem: matched,
          tpId: matched.id,
        };
      }
      return {
        status: 'DANGLING_REFERENCE',
        issue: `Kriteria KKTP '${criterion.id}' merujuk pada tpId '${criterion.tpId}' yang tidak ditemukan dalam daftar TP canonical (Dangling Reference).`,
      };
    }

    // Legacy migration only if tpId is empty
    const legacyCode = ((criterion as any).tpCode || '').trim().toLowerCase();
    if (legacyCode) {
      const codeCandidates = tpItems.filter(
        (t) => (t.code || '').trim().toLowerCase() === legacyCode
      );
      if (codeCandidates.length === 1) {
        return {
          status: 'LEGACY_MIGRATED',
          canonicalTPItem: codeCandidates[0],
          tpId: codeCandidates[0].id,
        };
      }
      if (codeCandidates.length > 1) {
        return {
          status: 'AMBIGUOUS_REFERENCE',
          issue: `Kode TP '${(criterion as any).tpCode}' pada kriteria '${criterion.id}' cocok dengan lebih dari 1 butir TP canonical (${codeCandidates.length} kecocokan).`,
        };
      }
    }

    const legacyStmt = ((criterion as any).tpStatement || '').trim().toLowerCase();
    if (legacyStmt) {
      const stmtCandidates = tpItems.filter(
        (t) => (t.statement || t.description || '').trim().toLowerCase() === legacyStmt
      );
      if (stmtCandidates.length === 1) {
        return {
          status: 'LEGACY_MIGRATED',
          canonicalTPItem: stmtCandidates[0],
          tpId: stmtCandidates[0].id,
        };
      }
      if (stmtCandidates.length > 1) {
        return {
          status: 'AMBIGUOUS_REFERENCE',
          issue: `Rumusan TP pada kriteria '${criterion.id}' cocok dengan lebih dari 1 butir TP canonical (${stmtCandidates.length} kecocokan).`,
        };
      }
    }

    const rawDesc = (criterion.description || '').trim();
    const cleanDesc = rawDesc.replace(/^Kriteria Ketercapaian:\s*/i, '').trim().toLowerCase();

    if (cleanDesc) {
      const statementCandidates = tpItems.filter(
        (t) => (t.statement || t.description || '').trim().toLowerCase() === cleanDesc
      );
      if (statementCandidates.length === 1) {
        return {
          status: 'LEGACY_MIGRATED',
          canonicalTPItem: statementCandidates[0],
          tpId: statementCandidates[0].id,
        };
      }
      if (statementCandidates.length > 1) {
        return {
          status: 'AMBIGUOUS_REFERENCE',
          issue: `Rumusan target pada kriteria '${criterion.id}' cocok dengan lebih dari 1 butir TP canonical (${statementCandidates.length} kecocokan).`,
        };
      }
    }

    return {
      status: 'UNRESOLVED_REFERENCE',
      issue: `Kriteria '${criterion.id}' belum terhubung dengan Tujuan Pembelajaran (TP) canonical manapun.`,
    };
  }

  // 2. Kurikulum 2013 KD Evaluation
  if (k13Analysis?.items && k13Analysis.items.length > 0) {
    if (criterion.tpId && criterion.tpId.trim()) {
      const trimmedId = criterion.tpId.trim();
      const matchedKD = k13Analysis.items.find((k) => k.id === trimmedId);
      if (matchedKD) {
        return {
          status: 'RESOLVED_REFERENCE',
          tpId: matchedKD.id,
        };
      }
      return {
        status: 'DANGLING_REFERENCE',
        issue: `Kriteria KD '${criterion.id}' merujuk pada KD '${criterion.tpId}' yang tidak ditemukan dalam daftar KD Kurikulum 2013.`,
      };
    }
    return {
      status: 'UNRESOLVED_REFERENCE',
      issue: `Kriteria '${criterion.id}' belum memiliki referensi KD canonical.`,
    };
  }

  return {
    status: 'UNRESOLVED_REFERENCE',
    issue: 'Daftar TP/KD rujukan belum tersedia.',
  };
}

/**
 * Validates a single KKM aspect score (kompleksitas, dayaDukung, intake).
 * Must be a finite number within the standard 0 to 100 range.
 */
export function isValidKkmAspect(val: unknown): val is number {
  return typeof val === 'number' && !isNaN(val) && val >= 0 && val <= 100;
}

/**
 * Calculates legacy KKM from 3 input aspects: kompleksitas, dayaDukung, and intake.
 * Returns null if any input is missing, null, undefined, NaN, or outside 0-100 range.
 * Strictly adheres to the principle: NO DATA > FAKE DATA.
 */
export function calculateLegacyKKM(
  kompleksitas: number | null | undefined,
  dayaDukung: number | null | undefined,
  intake: number | null | undefined
): number | null {
  if (
    !isValidKkmAspect(kompleksitas) ||
    !isValidKkmAspect(dayaDukung) ||
    !isValidKkmAspect(intake)
  ) {
    return null;
  }
  return Math.round((kompleksitas + dayaDukung + intake) / 3);
}

/**
 * Validates a single AssessmentCriterion against canonical TP and workflow rules.
 */
export function validateKKTPCriterion(
  criterion: AssessmentCriterion,
  tpItems: TPItem[],
  k13Analysis?: K13Analysis,
  tpUpdatedAt?: string
): {
  isValid: boolean;
  status: WorkflowCompletionStatus;
  issues: string[];
  referenceResult: CriterionReferenceResult;
} {
  const issues: string[] = [];
  const ref = resolveCriterionTPReference(criterion, tpItems, k13Analysis);

  if (ref.status === 'DANGLING_REFERENCE') {
    issues.push(ref.issue || 'Referensi TP rujukan tidak ditemukan (Dangling Reference).');
  } else if (ref.status === 'AMBIGUOUS_REFERENCE') {
    issues.push(ref.issue || 'Referensi target TP bersifat ambigu (lebih dari 1 butir cocok).');
  } else if (ref.status === 'UNRESOLVED_REFERENCE') {
    issues.push(ref.issue || 'Kriteria belum terhubung ke TP canonical.');
  }

  // Validate approach
  const validApproaches = ['rubrik', 'deskripsi', 'skala_interval', 'legacy_kkm'];
  if (!criterion.approach || !validApproaches.includes(criterion.approach)) {
    issues.push(`Pendekatan kriteria '${criterion.approach}' tidak valid.`);
  }

  // Content validation
  if (criterion.approach === 'rubrik') {
    if (!criterion.levels || criterion.levels.length === 0) {
      issues.push('Kriteria pendekatan rubrik belum memiliki kategori level performa.');
    } else {
      const emptyDesc = criterion.levels.some((lvl) => !lvl.description || !lvl.description.trim());
      if (emptyDesc) {
        issues.push('Terdapat deskripsi kategori rubrik yang masih kosong.');
      }
    }
  } else if (criterion.approach === 'deskripsi') {
    if (!criterion.indicators || criterion.indicators.length === 0) {
      issues.push('Daftar indikator kriteria ketercapaian belum diisi.');
    } else {
      const emptyInd = criterion.indicators.some((ind) => !ind || !ind.trim());
      if (emptyInd) {
        issues.push('Terdapat butir indikator kriteria yang masih kosong.');
      }
    }
  } else if (criterion.approach === 'skala_interval') {
    if (!criterion.levels || criterion.levels.length === 0) {
      issues.push('Skala interval nilai belum ditentukan oleh guru.');
    } else {
      const emptyInterval = criterion.levels.some(
        (lvl) => (!lvl.scoreRange && !lvl.label) || (!lvl.description && !lvl.label)
      );
      if (emptyInterval) {
        issues.push('Terdapat baris skala interval yang belum lengkap.');
      }
    }
  } else if (criterion.approach === 'legacy_kkm') {
    const hasAspects =
      criterion.kompleksitas !== undefined ||
      criterion.dayaDukung !== undefined ||
      criterion.intake !== undefined;

    if (hasAspects) {
      if (
        !isValidKkmAspect(criterion.kompleksitas) ||
        !isValidKkmAspect(criterion.dayaDukung) ||
        !isValidKkmAspect(criterion.intake)
      ) {
        issues.push('Unsur KKM (kompleksitas, daya dukung, intake) belum lengkap atau tidak valid.');
      }
    }

    if (
      criterion.passingThreshold === undefined ||
      criterion.passingThreshold === null ||
      isNaN(criterion.passingThreshold)
    ) {
      issues.push('Nilai KKM belum dihitung atau ditentukan.');
    }
  }

  // Upstream dependency staleness check
  if (tpUpdatedAt && criterion.basedOnTpUpdatedAt && criterion.basedOnTpUpdatedAt !== tpUpdatedAt) {
    issues.push('Tujuan Pembelajaran (TP) acuan telah diperbarui. Kriteria ketercapaian perlu ditinjau ulang.');
  }

  const isValid = issues.length === 0;
  let status: WorkflowCompletionStatus = 'DRAFT';
  if (!isValid || criterion.needsReview) {
    status = 'PERLU_DILENGKAPI';
  } else if (criterion.workflowStatus === 'SIAP') {
    status = 'SIAP';
  } else {
    status = 'DRAFT';
  }

  return {
    isValid,
    status,
    issues,
    referenceResult: ref,
  };
}

/**
 * Validates the full collection of KKTP criteria for an academic setting.
 */
export function validateKKTPData(
  criteria: AssessmentCriterion[],
  tp?: TPData,
  academicSetting?: AcademicSetting,
  k13Analysis?: K13Analysis
): {
  status: WorkflowCompletionStatus;
  isSiap: boolean;
  issues: string[];
  criteriaResults: Array<{
    criterionId: string;
    tpId: string;
    isValid: boolean;
    status: WorkflowCompletionStatus;
    issues: string[];
  }>;
} {
  const issues: string[] = [];
  const criteriaResults: Array<{
    criterionId: string;
    tpId: string;
    isValid: boolean;
    status: WorkflowCompletionStatus;
    issues: string[];
  }> = [];

  const isK13 = academicSetting?.curriculum === 'Kurikulum 2013';
  let allValid = true;

  if (!isK13) {
    if (!tp || !tp.items || tp.items.length === 0) {
      return {
        status: 'BELUM_DIMULAI',
        isSiap: false,
        issues: ['Daftar Tujuan Pembelajaran (TP) acuan belum tersedia.'],
        criteriaResults: [],
      };
    }
    if (tp.workflowStatus !== 'SIAP' || tp.needsReview) {
      issues.push('Tujuan Pembelajaran (TP) acuan belum berstatus SIAP atau masih memerlukan peninjauan ulang.');
      allValid = false;
    }
  }

  if (!criteria || criteria.length === 0) {
    return {
      status: 'BELUM_DIMULAI',
      isSiap: false,
      issues: ['Kriteria Ketercapaian Tujuan Pembelajaran (KKTP) belum dirumuskan.'],
      criteriaResults: [],
    };
  }

  const tpItems = tp?.items || [];

  criteria.forEach((crit) => {
    const res = validateKKTPCriterion(crit, tpItems, k13Analysis, tp?.updatedAt);
    criteriaResults.push({
      criterionId: crit.id,
      tpId: crit.tpId,
      isValid: res.isValid,
      status: res.status,
      issues: res.issues,
    });
    if (!res.isValid) {
      allValid = false;
      issues.push(...res.issues);
    }
  });

  // Check TP coverage for Merdeka
  if (!isK13 && tpItems.length > 0) {
    const coveredTpIds = new Set(criteria.map((c) => c.tpId));
    const uncovered = tpItems.filter((t) => !coveredTpIds.has(t.id));
    if (uncovered.length > 0) {
      issues.push(`Terdapat ${uncovered.length} Tujuan Pembelajaran yang belum memiliki kriteria ketercapaian.`);
      allValid = false;
    }
  }

  const allSiap =
    allValid &&
    criteria.length > 0 &&
    criteria.every((c) => c.workflowStatus === 'SIAP' && !c.needsReview);

  return {
    status: allSiap ? 'SIAP' : allValid ? 'DRAFT' : 'PERLU_DILENGKAPI',
    isSiap: allSiap,
    issues,
    criteriaResults,
  };
}
