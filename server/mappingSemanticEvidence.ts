export interface SemanticEvidence {
  supported: boolean;
  ambiguous: boolean;
  matchedSignals: string[];
  reason: string;
  /** Explicit, mutually exclusive movement domains; low lexical overlap is not a conflict. */
  hardConflict?: boolean;
}

const STOPWORDS = new Set([
  'aktivitas', 'ajar', 'anak', 'atau', 'bab', 'baik', 'cara', 'dan', 'dalam',
  'dengan', 'di', 'fisik', 'guru', 'ini', 'kegiatan', 'kelas', 'ke', 'langkah',
  'materi', 'melalui', 'mampu', 'pada', 'pembelajaran', 'peserta', 'siswa',
  'didik', 'secara', 'serta', 'tentang', 'untuk', 'yang',
]);

const COMPETENCE_WORDS = new Set([
  'analisis', 'menganalisis', 'memahami', 'menerapkan', 'menjelaskan',
  'mengidentifikasi', 'mempraktikkan', 'menunjukkan', 'melakukan',
]);

const GENERIC_SIGNALS = new Set(['gerak', 'variasi', 'kegiatan', 'aktivitas', 'materi', 'pembelajaran']);

const EQUIVALENTS: Record<string, string> = {
  bergerak: 'gerak',
  gerakan: 'gerak',
  perpindahan: 'lokomotor',
  berpindah: 'lokomotor',
  manipulasi: 'manipulatif',
  objek: 'manipulatif',
  aman: 'keselamatan',
  selamat: 'keselamatan',
  cedera: 'keselamatan',
  kesehatan: 'keselamatan',
  lokomosi: 'lokomotor',
  nonlokomotor: 'non-lokomotor',
};

function normalizeText(text?: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/non\s+lokomotor/g, 'non-lokomotor')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(token: string): string {
  const cleaned = normalizeText(token);
  return EQUIVALENTS[cleaned] || cleaned;
}

function tokens(text?: string): string[] {
  return Array.from(new Set(
    normalizeText(text)
      .split(/\s+/u)
      .map(normalizeToken)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !COMPETENCE_WORDS.has(token))
  ));
}

function hasTwoTokenPhrase(left: Set<string>, right: string[]): boolean {
  for (let i = 0; i < right.length - 1; i++) {
    if (left.has(right[i]) && left.has(right[i + 1])) return true;
  }
  return false;
}

function detectDomainConflict(labelTokens: string[], evidenceTokens: string[]): string | null {
  const getSpecificDomains = (tokensArr: string[]) => {
    const found = new Set<string>();
    if (tokensArr.includes('lokomotor')) found.add('lokomotor');
    if (tokensArr.includes('non-lokomotor')) found.add('non-lokomotor');
    if (tokensArr.includes('manipulatif')) found.add('manipulatif');
    if (tokensArr.includes('keselamatan')) found.add('keselamatan');
    return Array.from(found);
  };

  const labelDomains = getSpecificDomains(labelTokens);
  const evidenceDomains = getSpecificDomains(evidenceTokens);

  if (labelDomains.length > 0 && evidenceDomains.length > 0) {
    const allCovered = labelDomains.every((ld) => evidenceDomains.includes(ld));
    if (!allCovered) {
      return `Domain majemuk label (${labelDomains.join(', ')}) tidak sepenuhnya dicakup oleh domain bukti (${evidenceDomains.join(', ')}).`;
    }
  }

  return null;
}

function detectExplicitMovementConflict(label: string, evidence: string): string | null {
  const domains = (text: string) => normalizeText(text).split(/\s+/u)
    .filter(token => ['lokomotor', 'non-lokomotor', 'manipulatif'].includes(token));
  const labelDomains = new Set(domains(label));
  const evidenceDomains = new Set(domains(evidence));
  if (labelDomains.size && evidenceDomains.size && ![...labelDomains].some(domain => evidenceDomains.has(domain))) {
    return `Konflik domain gerak eksplisit: ${[...labelDomains].join(', ')} berlawanan dengan ${[...evidenceDomains].join(', ')}.`;
  }
  return null;
}

export function checkMappingSemanticEvidence(params: {
  label: string;
  atpItems?: Array<{ focus?: string; linkedTpIds?: string[]; tpId?: string }>;
  tpItems?: Array<{ statement?: string; competence?: string; contentScope?: string; id?: string }>;
}): SemanticEvidence {
  const labelTokens = tokens(params.label);
  const labelSet = new Set(labelTokens);
  if (labelTokens.length === 0) {
    return {
      supported: false,
      ambiguous: true,
      matchedSignals: [],
      reason: 'Judul tidak memuat sinyal substansi yang dapat dibandingkan.',
    };
  }

  const evidenceTexts = [
    ...(params.atpItems || []).map((item) => item.focus || ''),
    ...(params.tpItems || []).map((item) => `${item.statement || ''} ${item.contentScope || ''}`),
  ];

  const matchedSignals = new Set<string>();
  let phraseMatch = false;
  const allEvidenceTokens = new Set<string>();

  for (const text of evidenceTexts) {
    const candidateTokens = tokens(text);
    candidateTokens.forEach((token) => {
      allEvidenceTokens.add(token);
      if (labelSet.has(token)) matchedSignals.add(token);
    });
    if (hasTwoTokenPhrase(labelSet, candidateTokens)) {
      phraseMatch = true;
    }
  }

  const matches = Array.from(matchedSignals);
  const evidenceTokensArray = Array.from(allEvidenceTokens);

  const hardConflict = detectExplicitMovementConflict(params.label, evidenceTexts.join(' '));
  if (hardConflict) {
    return { supported: false, ambiguous: false, hardConflict: true, matchedSignals: matches, reason: hardConflict };
  }

  const domainConflict = detectDomainConflict(labelTokens, evidenceTokensArray);
  if (domainConflict) {
    return {
      supported: false,
      ambiguous: true,
      matchedSignals: matches,
      reason: `Domain pembelajaran berbeda: ${domainConflict}`,
    };
  }

  const hasSubstantiveSignal = matches.some((token) => !GENERIC_SIGNALS.has(token));

  if (phraseMatch || (matches.length >= 2 && hasSubstantiveSignal)) {
    return {
      supported: true,
      ambiguous: false,
      matchedSignals: matches,
      reason: `Ditemukan bukti substansi: ${matches.join(', ') || 'frasa terkait'}.`,
    };
  }

  if (matches.length === 1 || (matches.length > 0 && !hasSubstantiveSignal)) {
    return {
      supported: false,
      ambiguous: true,
      matchedSignals: matches,
      reason: `Sinyal substansi belum cukup atau generik (${matches.join(', ') || 'umum'}), belum cukup untuk menyatakan selaras.`,
    };
  }

  return {
    supported: false,
    ambiguous: false,
    matchedSignals: [],
    reason: 'Tidak ditemukan bukti substansi antara judul dan ATP tertaut.',
  };
}
