import type { TPItem, ATPItem } from '../types';

export interface ATPSemanticFidelityResult {
  isValid: boolean;
  reason?: string;
  matchedSignals: string[];
  missingSignals: string[];
}

const STOPWORDS = new Set([
  'agar', 'akan', 'atau', 'bagi', 'baik', 'cara', 'dalam', 'dan', 'dapat', 'dengan',
  'di', 'diri', 'hal', 'ini', 'itu', 'ke', 'kegiatan', 'konsep', 'langkah', 'materi',
  'melalui', 'pada', 'pembelajaran', 'peserta', 'siswa', 'didik', 'secara', 'sebagai',
  'serta', 'tentang', 'terhadap', 'untuk', 'yang',
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
    'mengaitkan', 'kait', 'menghubungkan', 'hubung', 'menyelidiki', 'selidik'
  ],
  practice: [
    'mempraktikkan', 'praktik', 'mendemonstrasikan', 'demonstrasi', 'melakukan', 'lakukan',
    'jaga', 'menjaga', 'peragakan', 'memperagakan', 'mainkan', 'memainkan', 'tunjukkan',
    'mempertunjukkan'
  ],
  create: [
    'membuat', 'buat', 'menyusun', 'susun', 'merancang', 'rancang', 'menghasilkan', 'hasil'
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

const MATERIAL_ONLY_STOPWORDS = new Set([
  ...STOPWORDS,
  ...Object.values(COMPETENCE_GROUPS).flatMap((words) => words),
  'mempelajari',
]);

const GENERIC_MATERIAL_TOKENS = new Set([
  'pola', 'gerak', 'dasar', 'aktivitas', 'materi', 'aturan', 'peran', 'kelompok', 'tahap', 'bagian'
]);

const COMPETENCE_EQUIVALENCE: Record<string, string[]> = {
  understand: ['understand', 'apply', 'analyze', 'create', 'evaluate'],
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

function normalizeToken(token: string): string {
  const normalized = normalizeText(token);
  const explicit: Record<string, string> = {
    analisis: 'analisis',
    menganalisis: 'analisis',
    paham: 'paham',
    memahami: 'paham',
    pemahaman: 'paham',
    jelas: 'jelas',
    menjelaskan: 'jelas',
    penjelasan: 'jelas',
    terap: 'terap',
    menerapkan: 'terap',
    penerapan: 'terap',
    praktik: 'praktik',
    mempraktikkan: 'praktik',
    demonstrasi: 'demonstrasi',
    mendemonstrasikan: 'demonstrasi',
    hitung: 'hitung',
    menghitung: 'hitung',
    jumlah: 'jumlah',
    menjumlahkan: 'jumlah',
    penjumlahan: 'jumlah',
    hubung: 'hubung',
    menghubungkan: 'hubung',
    kait: 'kait',
    mengaitkan: 'kait',
    evaluasi: 'evaluasi',
    mengevaluasi: 'evaluasi',
    refleksi: 'refleksi',
    merefleksi: 'refleksi',
    simpul: 'simpul',
    menyimpulkan: 'simpul',
    mengenal: 'mengenal',
    mengenali: 'mengenal',
    jaga: 'jaga',
    menjaga: 'jaga',
    eksplorasi: 'eksplorasi',
    mengeksplorasi: 'eksplorasi',
    partisipasi: 'partisipasi',
    berpartisipasi: 'partisipasi',
    aktif: 'partisipasi',
    susun: 'susun',
    menyusun: 'susun',
    rancang: 'rancang',
    merancang: 'rancang',
    mempertunjukkan: 'praktik',
    tunjukkan: 'praktik',
    amati: 'amati',
    mengamati: 'amati',
    selidik: 'selidik',
    menyelidiki: 'selidik',
    senilai: 'ekuivalen',
    ekuivalen: 'ekuivalen',
  };
  if (explicit[normalized]) return explicit[normalized];
  if (normalized.endsWith('nya') && normalized.length > 6) return normalized.slice(0, -3);
  return normalized;
}

function tokenize(value?: string, stopwords: Set<string> = STOPWORDS): string[] {
  const normalizedStopwords = new Set(Array.from(stopwords).map(normalizeToken));
  return normalizeText(value)
    .split(/\s+/u)
    .map(normalizeToken)
    .filter((token) => token.length >= 3 && !normalizedStopwords.has(token));
}

function uniqueTokens(value?: string, stopwords: Set<string> = STOPWORDS): string[] {
  return Array.from(new Set(tokenize(value, stopwords)));
}

function hasPhraseMatch(focusTokens: Set<string>, value?: string): boolean {
  const tokens = uniqueTokens(value, MATERIAL_ONLY_STOPWORDS);
  if (tokens.length < 2) return false;

  for (let i = 0; i < tokens.length - 1; i++) {
    if (focusTokens.has(tokens[i]) && focusTokens.has(tokens[i + 1])) return true;
  }
  return false;
}

function intersect(left: string[], rightSet: Set<string>): string[] {
  return left.filter((token) => rightSet.has(token));
}

function buildTpSubstance(tp: TPItem) {
  return {
    label: tp.code || tp.id,
    materialTokens: uniqueTokens(`${tp.contentScope || ''} ${tp.statement || ''}`, MATERIAL_ONLY_STOPWORDS),
    competenceTokens: uniqueTokens(tp.competence || ''),
    statementTokens: uniqueTokens(tp.statement || ''),
  };
}

export function detectCompetenceGroups(value?: string): string[] {
  const tokens = new Set(uniqueTokens(value));
  const detectedGroups = new Set<string>();

  for (const [group, words] of Object.entries(COMPETENCE_GROUPS)) {
    if (words.map(normalizeToken).some((word) => tokens.has(word))) {
      detectedGroups.add(group);
    }
  }

  return Array.from(detectedGroups);
}

/**
 * Extracts the substantiated competence demands of a canonical TP.
 * Distinguishes primary/compound competencies from verbs embedded in material descriptions.
 * Prevents bloated inherited competence lists (e.g. 4 verbs) from imposing unformulated demands.
 */
export function extractTPCompetenceGroups(tp: TPItem): string[] {
  if (tp.competence && tp.competence.trim().length > 0) {
    const rawGroups = detectCompetenceGroups(tp.competence);
    if (rawGroups.length <= 1) {
      return rawGroups;
    }
    // For compound competence: only enforce verbs that are actually substantiated by the TP statement.
    const statementTokens = new Set(uniqueTokens(tp.statement));
    const substantiated = rawGroups.filter((group) => {
      const words = COMPETENCE_GROUPS[group] || [];
      return words.map(normalizeToken).some((w) => statementTokens.has(w));
    });
    return substantiated.length > 0 ? substantiated : rawGroups;
  }

  // Fallback: extract from action clause at the beginning of the statement, not from the material body
  if (tp.statement && tp.statement.trim().length > 0) {
    const cleanStmt = tp.statement
      .replace(/^(peserta didik|murid|siswa)\s+(dapat|mampu)\s+/i, '')
      .trim();
    const headWords = cleanStmt.split(/\s+/).slice(0, 5).join(' ');
    const headGroups = detectCompetenceGroups(headWords);
    if (headGroups.length > 0) {
      return headGroups;
    }
    return detectCompetenceGroups(cleanStmt);
  }

  return [];
}

export function hasCompatibleCompetence(focusGroups: Set<string>, tpGroups: string[]): boolean {
  if (tpGroups.length === 0) return true;

  // Strict: every substantiated competence demanded by the TP must have an equivalent match in focus
  return tpGroups.every((tpGroup) => {
    const candidates = COMPETENCE_EQUIVALENCE[tpGroup] || [tpGroup];
    return candidates.some((candidate) => focusGroups.has(candidate));
  });
}

export function checkATPSemanticFidelity(
  focus: string | undefined,
  canonicalTPItems: TPItem[]
): ATPSemanticFidelityResult {
  const normalizedFocus = normalizeText(focus);
  if (!normalizedFocus) {
    return {
      isValid: false,
      reason: 'Fokus ATP kosong sehingga tidak dapat dibandingkan dengan TP canonical.',
      matchedSignals: [],
      missingSignals: ['focus'],
    };
  }

  if (!Array.isArray(canonicalTPItems) || canonicalTPItems.length === 0) {
    return {
      isValid: false,
      reason: 'TP canonical tertaut tidak tersedia untuk pemeriksaan semantic fidelity ATP.',
      matchedSignals: [],
      missingSignals: ['canonical TP'],
    };
  }

  const focusTokens = new Set(tokenize(focus));
  const focusMaterialTokens = new Set(tokenize(focus, MATERIAL_ONLY_STOPWORDS));
  const focusCompetenceGroups = detectCompetenceGroups(focus);
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];
  let coveredTpCount = 0;

  for (const tp of canonicalTPItems) {
    const substance = buildTpSubstance(tp);
    const materialMatches = intersect(substance.materialTokens, focusTokens);
    const statementMatches = intersect(substance.statementTokens, focusTokens);
    const phraseMatch = hasPhraseMatch(focusMaterialTokens, tp.contentScope) || hasPhraseMatch(focusMaterialTokens, tp.statement);

    const contentScopeTokens = uniqueTokens(tp.contentScope, MATERIAL_ONLY_STOPWORDS);
    const hasCompleteContentScopeMatch =
      contentScopeTokens.length > 0 && contentScopeTokens.every((t) => focusTokens.has(t));

    // Prevent false positive material match from a single generic token (e.g. 'pola', 'gerak', 'dasar')
    const specificMaterialMatches = materialMatches.filter((t) => !GENERIC_MATERIAL_TOKENS.has(t));
    const hasMaterialSignal =
      hasCompleteContentScopeMatch ||
      phraseMatch ||
      materialMatches.length >= 2 ||
      (materialMatches.length === 1 && specificMaterialMatches.length === 1 && specificMaterialMatches[0].length >= 5);

    const tpCompetenceGroups = extractTPCompetenceGroups(tp);
    const hasCompetenceSignal =
      tpCompetenceGroups.length === 0 ||
      hasCompatibleCompetence(new Set(focusCompetenceGroups), tpCompetenceGroups);

    if (hasMaterialSignal) {
      coveredTpCount += 1;
      matchedSignals.push(
        `${substance.label}: ${Array.from(new Set([...materialMatches, ...statementMatches])).slice(0, 5).join(', ') || 'frasa substansi'}`
      );
    } else {
      missingSignals.push(`${substance.label}: ${tp.contentScope || tp.statement || tp.id}`);
    }

    if (hasMaterialSignal && !hasCompetenceSignal) {
      const tpCompetenceLabel = tpCompetenceGroups.join(' & ') || tp.competence || 'kompetensi TP';
      missingSignals.push(`${substance.label}: fokus belum cukup menunjukkan kompetensi "${tpCompetenceLabel}" secara dapat diverifikasi.`);
    }
  }

  const allTpCovered = coveredTpCount === canonicalTPItems.length;

  if (!allTpCovered) {
    return {
      isValid: false,
      reason: `Fokus ATP tidak cukup relevan dengan substansi TP canonical tertaut (${missingSignals.join('; ')}).`,
      matchedSignals,
      missingSignals,
    };
  }

  if (missingSignals.some((signal) => signal.includes('belum cukup menunjukkan'))) {
    return {
      isValid: false,
      reason: `Fokus ATP ambigu: ada kecocokan materi tetapi kompetensi TP belum cukup dapat ditinjau (${missingSignals.join('; ')}).`,
      matchedSignals,
      missingSignals,
    };
  }

  return {
    isValid: true,
    matchedSignals,
    missingSignals,
  };
}

export function validateATPGeneratedItemsSemanticFidelity(
  items: Pick<ATPItem, 'stepNumber' | 'linkedTpIds' | 'focus'>[],
  canonicalTPItems: TPItem[]
): ATPSemanticFidelityResult {
  const tpMap = new Map(canonicalTPItems.map((tp) => [tp.id, tp]));
  const matchedSignals: string[] = [];
  const missingSignals: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const stepNumber = item.stepNumber || i + 1;
    const linkedTpIds = Array.isArray(item.linkedTpIds) ? item.linkedTpIds : [];
    const linkedTps = linkedTpIds.map((id) => tpMap.get(id)).filter((tp): tp is TPItem => Boolean(tp));
    const result = checkATPSemanticFidelity(item.focus, linkedTps);

    matchedSignals.push(...result.matchedSignals.map((signal) => `Langkah ${stepNumber} ${signal}`));
    if (!result.isValid) {
      missingSignals.push(`Langkah ${stepNumber}: ${result.reason || 'semantic fidelity ATP gagal.'}`);
    }
  }

  return {
    isValid: missingSignals.length === 0,
    reason: missingSignals.length > 0 ? missingSignals.join(' ') : undefined,
    matchedSignals,
    missingSignals,
  };
}
