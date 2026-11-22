import type { CPData, CPAnalysisItem } from '../types';

export type CPAnalysisSemanticFindingType =
  | 'COMPETENCE_MISMATCH'
  | 'MATERIAL_MISSING'
  | 'UNSUPPORTED_ADDITION'
  | 'SUGGESTED_TP_INCONSISTENT';

export type CPAnalysisFindingSeverity = 'WARNING' | 'INFO';

export interface CPAnalysisSuggestedChange {
  field: 'cpCompetence' | 'materialScope' | 'suggestedTp';
  fieldLabel: string;
  currentValue: string;
  suggestedValue: string;
}

export interface CPAnalysisSemanticFinding {
  id: string;
  itemId: string;
  itemOrder?: number;
  elementId?: string;
  elementName?: string;
  type: CPAnalysisSemanticFindingType;
  severity: CPAnalysisFindingSeverity;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  reason: string;
  evidence: {
    cpText?: string;
    analysisCompetence?: string;
    analysisMaterial?: string;
    suggestedTp?: string;
  };
  suggestion: string;
  canAutoApply: boolean;
  suggestedChange?: CPAnalysisSuggestedChange;
}

export interface AppliedFindingRecord {
  findingId: string;
  itemId: string;
  field: keyof CPAnalysisItem;
  previousValue: any;
  appliedValue: any;
  appliedAt: string;
}

export interface CPAnalysisSemanticReviewResult {
  isValid: boolean;
  totalFindings: number;
  warningCount: number;
  infoCount: number;
  findings: CPAnalysisSemanticFinding[];
  summaryMessage: string;
  reviewedAt: string;
}

const STOPWORDS = new Set([
  'agar', 'akan', 'atau', 'bagi', 'baik', 'cara', 'dalam', 'dan', 'dapat', 'dengan',
  'di', 'diri', 'hal', 'ini', 'itu', 'ke', 'kegiatan', 'konsep', 'langkah', 'materi',
  'melalui', 'pada', 'pembelajaran', 'peserta', 'siswa', 'didik', 'secara', 'sebagai',
  'serta', 'tentang', 'terhadap', 'untuk', 'yang', 'mampu', 'fase', 'elemen', 'akhir',
  'kehidupan', 'sehari-hari', 'konteks', 'lingkungan', 'berbagai', 'macam', 'jenis',
]);

const COMPETENCE_GROUPS: Record<string, string[]> = {
  understand: [
    'memahami', 'pemahaman', 'paham', 'menjelaskan', 'jelas', 'menguraikan', 'uraikan',
    'mengenal', 'mengenali', 'identifikasi', 'mengidentifikasi', 'menunjukkan', 'ketahui', 'mengetahui'
  ],
  apply: [
    'menerapkan', 'penerapan', 'terap', 'menggunakan', 'gunakan', 'menentukan', 'tentukan',
    'menghitung', 'hitung'
  ],
  analyze: [
    'menganalisis', 'analisis', 'menelaah', 'telaah', 'membandingkan', 'banding',
    'mengaitkan', 'kait', 'menghubungkan', 'hubung', 'menyelidiki', 'selidik', 'membedakan'
  ],
  practice: [
    'mempraktikkan', 'praktik', 'mendemonstrasikan', 'demonstrasi', 'melakukan', 'lakukan',
    'jaga', 'menjaga', 'peragakan', 'memperagakan', 'mainkan', 'memainkan', 'tunjukkan',
    'mempertunjukkan'
  ],
  create: [
    'membuat', 'buat', 'menyusun', 'susun', 'merancang', 'rancang', 'menghasilkan', 'hasil', 'menciptakan'
  ],
  evaluate: [
    'mengevaluasi', 'evaluasi', 'menilai', 'nilai', 'merefleksi', 'refleksi', 'menyimpulkan', 'simpul'
  ],
  explore: [
    'mengeksplorasi', 'eksplorasi', 'menjelajahi', 'jelajah'
  ],
  participate: [
    'berpartisipasi', 'partisipasi', 'ikut', 'mengikuti', 'terlibat', 'keterlibatan', 'turut'
  ],
  observe: [
    'mengamati', 'amati', 'pengamatan', 'observasi'
  ],
};

const COMPETENCE_EQUIVALENCE: Record<string, string[]> = {
  understand: ['understand'],
  apply: ['apply', 'practice'],
  analyze: ['analyze'],
  practice: ['practice', 'apply'],
  create: ['create'],
  evaluate: ['evaluate'],
  explore: ['explore'],
  participate: ['participate'],
  observe: ['observe'],
};

function normalizeText(value?: string): string {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSubstantiveTokens(text?: string): string[] {
  if (!text) return [];
  const normalized = normalizeText(text);
  return normalized
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

export function detectCompetenceGroups(text?: string): string[] {
  if (!text) return [];
  const tokens = new Set(extractSubstantiveTokens(text));
  const detected = new Set<string>();

  for (const [group, words] of Object.entries(COMPETENCE_GROUPS)) {
    if (words.some((w) => tokens.has(w) || normalizeText(text).includes(w))) {
      detected.add(group);
    }
  }

  return Array.from(detected);
}

function areCompetenceGroupsCompatible(groupsA: string[], groupsB: string[]): boolean {
  if (groupsA.length === 0 || groupsB.length === 0) return true;
  return groupsA.some((gA) => {
    const equiv = COMPETENCE_EQUIVALENCE[gA] || [gA];
    return groupsB.some((gB) => equiv.includes(gB));
  });
}

/**
 * Splits CP text into atomic substantive clauses/segments for coverage and competence checking.
 */
export function splitCPSubstantiveClauses(text?: string): string[] {
  if (!text || !text.trim()) return [];
  return text
    .split(/;\s*|\.\s+(?=[A-Z0-9])|,\s*serta\s+|\r?\n+/i)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 8);
}

/**
 * Extracts all action verbs directly from a specific text fragment, preserving appearance order.
 * NEVER artificially slices or truncates compound verbs.
 */
function extractActionVerbsFromText(text: string): string[] {
  if (!text || !text.trim()) return [];
  const lower = text.toLowerCase();

  const allGroups = [
    'practice',
    'apply',
    'analyze',
    'create',
    'evaluate',
    'explore',
    'participate',
    'observe',
    'understand',
  ];

  interface VerbMatch {
    verb: string;
    index: number;
  }

  const matches: VerbMatch[] = [];
  const seenBase = new Set<string>();

  for (const group of allGroups) {
    const verbs = COMPETENCE_GROUPS[group] || [];
    for (const v of verbs) {
      if (v.length < 4) continue;
      const regex = new RegExp(`\\b${v}\\b`, 'gi');
      let m: RegExpExecArray | null;
      while ((m = regex.exec(lower)) !== null) {
        const canonicalBase = v.toLowerCase();
        if (!seenBase.has(canonicalBase)) {
          seenBase.add(canonicalBase);
          matches.push({
            verb: v.charAt(0).toUpperCase() + v.slice(1).toLowerCase(),
            index: m.index,
          });
        }
      }
    }
  }

  matches.sort((a, b) => a.index - b.index);
  return matches.map((m) => m.verb);
}

/**
 * Formats an array of verbs into authentic Indonesian compound competence phrasing without truncation.
 */
export function formatCompoundCompetence(verbs: string[]): string {
  if (verbs.length === 0) return '';
  if (verbs.length === 1) return verbs[0];
  if (verbs.length === 2) return `${verbs[0]} dan ${verbs[1].toLowerCase()}`;
  const leading = verbs.slice(0, -1).map((v, i) => (i === 0 ? v : v.toLowerCase())).join(', ');
  const last = verbs[verbs.length - 1].toLowerCase();
  return `${leading}, dan ${last}`;
}

export interface ResolvedTargetCompetence {
  targetCompetence: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  canAutoApply: boolean;
  matchedClause?: string;
}

/**
 * Resolves the appropriate competence recommendation for a specific analysis item.
 * - Tailors the suggestion to the substantive scope of the specific row.
 * - Does not copy all verbs from disparate CP clauses.
 * - Preserves all compound verbs in the relevant clause without artificial truncation.
 * - If competence cannot be verified with certainty, returns canAutoApply: false.
 * - Does not fabricate alien verbs or materials.
 */
export function resolveTargetCompetenceForAnalysis(
  cpText?: string,
  materialScope?: string
): ResolvedTargetCompetence {
  if (!cpText || !cpText.trim()) {
    return { targetCompetence: '', confidence: 'LOW', canAutoApply: false };
  }

  const clauses = splitCPSubstantiveClauses(cpText);

  // If there's only 1 clause or CP text is short
  if (clauses.length <= 1) {
    const verbs = extractActionVerbsFromText(cpText);
    if (verbs.length === 0) {
      return { targetCompetence: '', confidence: 'LOW', canAutoApply: false };
    }
    return {
      targetCompetence: formatCompoundCompetence(verbs),
      confidence: 'HIGH',
      canAutoApply: true,
      matchedClause: cpText,
    };
  }

  // Multi-clause element: match against row's substantive material scope
  if (materialScope && materialScope.trim()) {
    const matTokens = extractSubstantiveTokens(materialScope);
    let bestClause: string | null = null;
    let bestScore = 0;

    for (const clause of clauses) {
      const clauseTokens = new Set(extractSubstantiveTokens(clause));
      const matchCount = matTokens.filter((t) => clauseTokens.has(t)).length;
      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestClause = clause;
      }
    }

    if (bestClause && bestScore >= 1) {
      const verbs = extractActionVerbsFromText(bestClause);
      if (verbs.length > 0) {
        return {
          targetCompetence: formatCompoundCompetence(verbs),
          confidence: 'HIGH',
          canAutoApply: true,
          matchedClause: bestClause,
        };
      }
    }
  }

  // If materialScope doesn't match a specific clause, but all clauses share the same verbs
  const allVerbsPerClause = clauses.map((c) => extractActionVerbsFromText(c));
  const flatVerbs = Array.from(new Set(allVerbsPerClause.flat()));

  if (flatVerbs.length === 1) {
    return {
      targetCompetence: flatVerbs[0],
      confidence: 'MEDIUM',
      canAutoApply: true,
    };
  }

  // Multi-clause with disparate verbs and cannot determine which belongs to this row:
  // Cannot be verified with certainty -> Teacher Review Required (Perlu Tinjauan Guru)
  return {
    targetCompetence: '',
    confidence: 'LOW',
    canAutoApply: false,
  };
}

/**
 * Extracts action verbs directly from CP text for backward compatibility.
 */
export function extractTargetCompetenceFromCP(cpText?: string, materialScope?: string): string {
  return resolveTargetCompetenceForAnalysis(cpText, materialScope).targetCompetence;
}

/**
 * Applies a finding's suggested change to a list of CPAnalysisItem, with optional user customization.
 * Guarantees that ONLY the target field of the specific row is updated.
 */
export function applyFindingToItems(
  items: CPAnalysisItem[],
  finding: CPAnalysisSemanticFinding,
  customValue?: string
): { updatedItems: CPAnalysisItem[]; record?: AppliedFindingRecord } {
  if (!finding.suggestedChange || !finding.itemId) {
    return { updatedItems: items };
  }

  const { field, currentValue, suggestedValue } = finding.suggestedChange;
  const valueToApply = customValue !== undefined ? customValue : suggestedValue;

  const targetItem = items.find((it) => it.id === finding.itemId);
  if (!targetItem) {
    return { updatedItems: items };
  }

  const previousValue = targetItem[field] ?? currentValue;
  const updatedItems = items.map((it) => {
    if (it.id !== finding.itemId) return it;
    return {
      ...it,
      [field]: valueToApply,
    };
  });

  const record: AppliedFindingRecord = {
    findingId: finding.id,
    itemId: finding.itemId,
    field,
    previousValue,
    appliedValue: valueToApply,
    appliedAt: new Date().toISOString(),
  };

  return { updatedItems, record };
}

export interface UndoResult {
  success: boolean;
  updatedItems: CPAnalysisItem[];
  reason: 'MATCH_REVERTED' | 'VALUE_MODIFIED_MANUALLY' | 'ITEM_NOT_FOUND';
  message: string;
}

/**
 * Undoes an applied suggestion safely.
 * Only reverts if the current field value still strictly matches appliedValue.
 * If the teacher has manually edited the field after applying, the manual edit is preserved!
 */
export function undoAppliedFinding(
  items: CPAnalysisItem[],
  record: AppliedFindingRecord
): UndoResult {
  const targetItem = items.find((it) => it.id === record.itemId);
  if (!targetItem) {
    return {
      success: false,
      updatedItems: items,
      reason: 'ITEM_NOT_FOUND',
      message: 'Baris analisis tidak ditemukan atau telah dihapus.',
    };
  }

  const currentValue = targetItem[record.field];
  // Urungkan hanya jika nilai saat ini masih sama dengan nilai hasil penerapan
  if (currentValue !== record.appliedValue) {
    return {
      success: false,
      updatedItems: items,
      reason: 'VALUE_MODIFIED_MANUALLY',
      message: `Tidak dapat mengurungkan: kolom "${String(record.field)}" telah diedit secara manual setelah saran diterapkan. Perubahan manual Anda tetap dipertahankan.`,
    };
  }

  const updatedItems = items.map((it) => {
    if (it.id !== record.itemId) return it;
    return {
      ...it,
      [record.field]: record.previousValue,
    };
  });

  return {
    success: true,
    updatedItems,
    reason: 'MATCH_REVERTED',
    message: 'Perubahan pada baris berhasil diurungkan ke nilai sebelum saran diterapkan.',
  };
}

/**
 * Evaluates semantic quality and curriculum fidelity of CP Analysis items against canonical CP data.
 * Pure function: does not mutate inputs, does not perform network calls.
 */
export function reviewCPAnalysisSemantic(
  items: CPAnalysisItem[],
  cp: CPData
): CPAnalysisSemanticReviewResult {
  const findings: CPAnalysisSemanticFinding[] = [];
  const canonicalElements = cp.elements || [];
  const canonicalElemMap = new Map<string, (typeof canonicalElements)[0]>();
  canonicalElements.forEach((el) => {
    if (el.id) canonicalElemMap.set(el.id.trim(), el);
  });

  // Track elements that have been analyzed
  const analyzedElemIds = new Set<string>();

  // Map items per element for multi-item element coverage check
  const itemsByElemId = new Map<string, CPAnalysisItem[]>();
  items.forEach((item) => {
    if (item.elementId) {
      const eid = item.elementId.trim();
      analyzedElemIds.add(eid);
      const list = itemsByElemId.get(eid) || [];
      list.push(item);
      itemsByElemId.set(eid, list);
    }
  });

  // 1. Evaluate per-item semantic quality
  for (const item of items) {
    const canonicalElem = item.elementId ? canonicalElemMap.get(item.elementId.trim()) : undefined;
    const cpText = canonicalElem?.content || item.cpText || cp.generalDescription || '';

    // A. Check Competence Mismatch
    if (item.cpCompetence && item.cpCompetence.trim().length > 0 && cpText.trim().length > 0) {
      const cpCompGroups = detectCompetenceGroups(cpText);
      const analysisCompGroups = detectCompetenceGroups(item.cpCompetence);

      if (cpCompGroups.length > 0 && analysisCompGroups.length > 0) {
        const isCompatible = areCompetenceGroupsCompatible(cpCompGroups, analysisCompGroups);

        if (!isCompatible) {
          // Identify specific shift: e.g. practice -> understand
          const isPracticeToUnderstand =
            cpCompGroups.includes('practice') && !analysisCompGroups.includes('practice') && analysisCompGroups.includes('understand');
          const isHigherOrderReduced =
            (cpCompGroups.includes('analyze') || cpCompGroups.includes('create') || cpCompGroups.includes('evaluate')) &&
            !analysisCompGroups.some((g) => ['analyze', 'create', 'evaluate'].includes(g)) &&
            analysisCompGroups.includes('understand');

          const shiftDescription = isPracticeToUnderstand
            ? 'Teks CP menuntut keterampilan praktik atau tindakan konkret, sedangkan analisis menurunkan tuntutan menjadi sekadar pemahaman/teori.'
            : isHigherOrderReduced
            ? 'Teks CP menuntut penalaran tingkat tinggi (analisis/kreasi/evaluasi), sedangkan analisis menurunkan tuntutan menjadi pemahaman dasar.'
            : `Tuntutan kompetensi pada analisis ("${item.cpCompetence}") berbeda tingkat atau jenis keterampilannya dengan teks CP.`;

          const compResolution = resolveTargetCompetenceForAnalysis(cpText, item.materialScope);
          const canAutoApply = compResolution.canAutoApply && Boolean(compResolution.targetCompetence);
          const targetCompetence = compResolution.targetCompetence;

          const suggestedChange: CPAnalysisSuggestedChange | undefined = canAutoApply
            ? {
                field: 'cpCompetence',
                fieldLabel: 'Kata Kerja Operasional (Kompetensi)',
                currentValue: item.cpCompetence || '',
                suggestedValue: targetCompetence,
              }
            : undefined;

          findings.push({
            id: `finding-${item.id}-COMPETENCE_MISMATCH-${findings.length + 1}`,
            itemId: item.id,
            itemOrder: item.order,
            elementId: item.elementId,
            elementName: item.elementName || canonicalElem?.name,
            type: 'COMPETENCE_MISMATCH',
            severity: 'WARNING',
            confidence: canAutoApply ? compResolution.confidence : 'LOW',
            title: 'Tingkat Kompetensi Berbeda dengan Teks CP',
            reason: shiftDescription,
            evidence: {
              cpText,
              analysisCompetence: item.cpCompetence,
              analysisMaterial: item.materialScope,
            },
            suggestion: canAutoApply
              ? `Sesuaikan kompetensi menjadi "${targetCompetence}" agar selaras dengan tuntutan tindakan pada teks CP rujukan.`
              : `Sesuaikan Kata Kerja Operasional (KKO) agar mencerminkan tindakan pembelajaran yang ditargetkan pada teks CP (tinjau langsung pada baris analisis ini).`,
            canAutoApply,
            suggestedChange,
          });
        }
      }
    }

    // B. Check Unsupported Material Addition
    if (item.materialScope && item.materialScope.trim().length > 0 && cpText.trim().length > 0) {
      const materialTokens = extractSubstantiveTokens(item.materialScope);
      const cpTokens = new Set(extractSubstantiveTokens(cpText));

      // Also check against full CP general description if available
      const fullCPTokens = new Set(extractSubstantiveTokens(`${cp.generalDescription || ''} ${cpText}`));

      if (materialTokens.length >= 2) {
        const matchingTokens = materialTokens.filter((token) => fullCPTokens.has(token));
        // If ZERO substantive tokens match anywhere in the CP element or general description
        if (matchingTokens.length === 0) {
          findings.push({
            id: `finding-${item.id}-UNSUPPORTED_ADDITION-${findings.length + 1}`,
            itemId: item.id,
            itemOrder: item.order,
            elementId: item.elementId,
            elementName: item.elementName || canonicalElem?.name,
            type: 'UNSUPPORTED_ADDITION',
            severity: 'WARNING',
            confidence: 'MEDIUM',
            title: 'Lingkup Materi Tidak Ditemukan Dukungannya pada CP',
            reason: `Lingkup materi "${item.materialScope}" tidak memuat kata kunci atau konsep yang didukung oleh rumusan CP elemen ini.`,
            evidence: {
              cpText,
              analysisMaterial: item.materialScope,
            },
            suggestion: `Pastikan materi yang dianalisis bersumber langsung dari pokok bahasan CP elemen ini atau sesuaikan rumusan materi inti.`,
            canAutoApply: false,
          });
        }
      }
    }

    // C. Check Suggested TP Consistency (if provided)
    if (item.suggestedTp && item.suggestedTp.trim().length >= 15) {
      const suggestedTp = item.suggestedTp.trim();
      const tpCompGroups = detectCompetenceGroups(suggestedTp);
      const itemCompGroups = detectCompetenceGroups(item.cpCompetence);

      const hasCompConflict =
        itemCompGroups.length > 0 &&
        tpCompGroups.length > 0 &&
        !areCompetenceGroupsCompatible(itemCompGroups, tpCompGroups);

      const tpTokens = new Set(extractSubstantiveTokens(suggestedTp));
      const materialTokens = extractSubstantiveTokens(item.materialScope);
      const hasMaterialOverlap =
        materialTokens.length === 0 || materialTokens.some((t) => tpTokens.has(t));

      if (hasCompConflict || !hasMaterialOverlap) {
        const comp = (item.cpCompetence || '').trim();
        const mat = (item.materialScope || '').trim();
        const canFormulateTp = Boolean(comp.length > 0 && mat.length > 0);
        const cleanComp = comp ? comp.charAt(0).toLowerCase() + comp.slice(1) : '';
        const cleanMat = mat ? mat.charAt(0).toLowerCase() + mat.slice(1) : '';
        const recommendedTp = canFormulateTp
          ? `Peserta didik mampu ${cleanComp} ${cleanMat}.`
          : '';

        const suggestedChange: CPAnalysisSuggestedChange | undefined = canFormulateTp
          ? {
              field: 'suggestedTp',
              fieldLabel: 'Usulan Rumusan TP',
              currentValue: item.suggestedTp || '',
              suggestedValue: recommendedTp,
            }
          : undefined;

        findings.push({
          id: `finding-${item.id}-SUGGESTED_TP_INCONSISTENT-${findings.length + 1}`,
          itemId: item.id,
          itemOrder: item.order,
          elementId: item.elementId,
          elementName: item.elementName || canonicalElem?.name,
          type: 'SUGGESTED_TP_INCONSISTENT',
          severity: 'WARNING',
          confidence: 'MEDIUM',
          title: 'Usulan TP Belum Selaras dengan Baris Analisis',
          reason: hasCompConflict
            ? `Rumusan draf TP memuat kata kerja tindakan yang tidak selaras dengan kompetensi analisis ("${item.cpCompetence}").`
            : `Rumusan draf TP belum memuat konsep lingkup materi inti ("${item.materialScope}").`,
          evidence: {
            analysisCompetence: item.cpCompetence,
            analysisMaterial: item.materialScope,
            suggestedTp: item.suggestedTp,
          },
          suggestion: canFormulateTp
            ? `Perbarui usulan TP menjadi: "${recommendedTp}" agar mencerminkan kompetensi dan materi baris ini.`
            : `Rumuskan usulan TP dengan memadukan kompetensi "${item.cpCompetence || 'KKO'}" dan lingkup materi "${item.materialScope || 'Materi'}".`,
          canAutoApply: canFormulateTp,
          suggestedChange,
        });
      }
    }
  }

  // 2. Evaluate Element-Level Material Coverage (MATERIAL_MISSING)
  for (const el of canonicalElements) {
    if (!el.id) continue;
    const eid = el.id.trim();
    const elemItems = itemsByElemId.get(eid) || [];

    if (elemItems.length === 0) {
      // Element has no analysis items at all
      findings.push({
        id: `finding-${eid}-MISSING_ELEM-${findings.length + 1}`,
        itemId: `missing-elem-${eid}`,
        elementId: eid,
        elementName: el.name,
        type: 'MATERIAL_MISSING',
        severity: 'WARNING',
        confidence: 'HIGH',
        title: `Elemen CP "${el.name}" Belum Dianalisis`,
        reason: `Elemen CP "${el.name}" belum memiliki baris bedah kompetensi dan materi sama sekali.`,
        evidence: {
          cpText: el.content,
        },
        suggestion: `Tambahkan baris analisis baru dan pilih elemen "${el.name}" untuk membedah kompetensi serta materinya.`,
        canAutoApply: false,
      });
      continue;
    }

    // Check if major substantive clauses of this element are represented across its items
    const combinedElemMaterial = elemItems.map((it) => `${it.cpCompetence} ${it.materialScope}`).join(' ');
    const combinedTokens = new Set(extractSubstantiveTokens(combinedElemMaterial));

    const clauses = splitCPSubstantiveClauses(el.content);
    for (const clause of clauses) {
      const clauseTokens = extractSubstantiveTokens(clause);
      if (clauseTokens.length >= 3) {
        const matched = clauseTokens.filter((t) => combinedTokens.has(t));
        // If less than 20% of the substantive tokens of this major clause are represented
        if (matched.length === 0 || (clauseTokens.length >= 4 && matched.length < 2)) {
          findings.push({
            id: `finding-${eid}-CLAUSE_MISSING-${findings.length + 1}`,
            itemId: elemItems[0].id,
            itemOrder: elemItems[0].order,
            elementId: eid,
            elementName: el.name,
            type: 'MATERIAL_MISSING',
            severity: 'WARNING',
            confidence: 'MEDIUM',
            title: `Bagian Lingkup Materi CP Belum Terwakili`,
            reason: `Klausa pokok CP: "${clause.length > 90 ? clause.slice(0, 87) + '...' : clause}" belum terlihat dicakup oleh butir-butir analisis pada elemen "${el.name}".`,
            evidence: {
              cpText: el.content,
              analysisMaterial: combinedElemMaterial,
            },
            suggestion: `Tinjau kembali apakah materi terkait "${clauseTokens.slice(0, 3).join(', ')}" perlu ditambahkan pada lingkup materi atau dibuatkan baris analisis terpisah.`,
            canAutoApply: false,
          });
        }
      }
    }
  }

  const warningCount = findings.filter((f) => f.severity === 'WARNING').length;
  const infoCount = findings.filter((f) => f.severity === 'INFO').length;

  let summaryMessage = 'Tidak ditemukan indikasi ketidakselarasan. Butir Analisis CP selaras secara semantik pada pemeriksaan otomatis (guru tetap disarankan memverifikasi konteks pembelajaran).';
  if (warningCount > 0) {
    summaryMessage = `Ditemukan ${warningCount} catatan keselarasan semantik yang disarankan untuk ditinjau oleh guru.`;
  }

  return {
    isValid: true, // Non-fatal advisory quality review
    totalFindings: findings.length,
    warningCount,
    infoCount,
    findings,
    summaryMessage,
    reviewedAt: new Date().toISOString(),
  };
}
