import { ActiveContext, AcademicSetting, CPSource, CPElem, CPVerificationStatus, normalizeCPVerificationStatus } from '../types';
import {
  ALL_MASTER_CP_ENTRIES,
  REVIEW_CP046_ENTRIES,
  MasterCPEntry,
  CPElement,
  parseAcademicYearStart,
  resolveCPContext,
} from '../data/curriculum/cp';
import { CurriculumPhase, SchoolLevel } from '../data/curriculum/types';
import { getRegulationSource } from '../data/curriculum/regulations';
import { findSubjectByCode, findSubjectByNameOrAlias, findCP046Subject } from '../data/curriculum/subjects';

export interface CPSourceSearchResult {
  id: string;
  subject: string;
  level: string;
  grade: string;
  phase: string;
  curriculum: string;
  title: string;
  institution: string;
  documentYear: string;
  url?: string;
  page?: string;
  verificationStatus: CPVerificationStatus;
  generalDescription: string;
  elements: CPElem[];
  sourceMeta: CPSource;
  confidenceScore: number;
  statusReason?: string;
  isSelectable?: boolean;
}

export interface CPSourceSearchReport {
  context: Pick<ActiveContext, 'subject' | 'level' | 'phase' | 'academicYear'>;
  status: 'RESOLVED' | 'UNRESOLVED' | 'AMBIGUOUS';
  reason: string;
  results: CPSourceSearchResult[];
}

const ALIAS_CLUSTERS: string[][] = [
  // PJOK
  ['pjok', 'pendidikan jasmani olahraga dan kesehatan', 'pendidikan jasmani olahraga & kesehatan', 'pendidikan jasmani dan olahraga', 'pendidikan jasmani', 'penjas', 'penjasorkes', 'olahraga', 'kesehatan'],
  // Bahasa Indonesia
  ['bahasa indonesia', 'b indonesia', 'b indo', 'bindo', 'indonesia'],
  // Bahasa Inggris
  ['bahasa inggris', 'b inggris', 'b ing', 'binggris', 'english'],
  // IPAS
  ['ipas', 'ilmu pengetahuan alam dan sosial', 'ilmu pengetahuan alam & sosial', 'ipa dan ips', 'ipa & ips'],
  // IPA
  ['ipa', 'ilmu pengetahuan alam', 'sains', 'natural science', 'biologi dan fisika'],
  // IPS
  ['ips', 'ilmu pengetahuan sosial', 'social science', 'sosial'],
  // Matematika
  ['matematika', 'mtk', 'math', 'mathematics', 'matematik', 'berhitung'],
  // Pendidikan Pancasila
  ['pendidikan pancasila', 'pancasila', 'ppkn', 'pkn', 'pendidikan kewarganegaraan', 'kewarganegaraan'],
  // Informatika
  ['informatika', 'tik', 'teknologi informasi dan komunikasi', 'komputer', 'teknologi informasi', 'koding', 'coding', 'ilmu komputer'],
  // Seni Budaya & Rupa/Musik/Tari/Teater
  ['seni budaya', 'seni rupa', 'seni musik', 'seni tari', 'seni teater', 'seni dan prakarya', 'seni budaya dan prakarya', 'sbkp', 'seni'],
  // Prakarya & Kewirausahaan
  ['prakarya', 'kewirausahaan', 'prakarya dan kewirausahaan', 'pkwu', 'kerajinan'],
  // PAI & Budi Pekerti
  ['pendidikan agama islam dan budi pekerti', 'pendidikan agama islam', 'pai', 'agama islam', 'pabp', 'budi pekerti'],
  // Pendidikan Agama Kristen
  ['pendidikan agama kristen dan budi pekerti', 'pendidikan agama kristen', 'pak', 'agama kristen'],
  // Pendidikan Agama Katolik
  ['pendidikan agama katolik dan budi pekerti', 'pendidikan agama katolik', 'agama katolik'],
  // Sejarah
  ['sejarah', 'sejarah indonesia', 'history'],
  // Geografi, Sosiologi, Ekonomi, Fisika, Kimia, Biologi
  ['geografi'],
  ['sosiologi'],
  ['ekonomi', 'akuntansi'],
  ['fisika'],
  ['kimia'],
  ['biologi'],
  // Bahasa Daerah / Muatan Lokal
  ['muatan lokal', 'mulok', 'bahasa daerah', 'bahasa jawa', 'bahasa sunda', 'bahasa bali'],
];

const STOP_WORDS = new Set([
  'dan',
  'atau',
  'di',
  'ke',
  'dari',
  'pada',
  'untuk',
  'dengan',
  'mata',
  'pelajaran',
  'mapel',
  'bidang',
  'studi',
  'fase',
  'kelas',
  'kurikulum',
  'wajib',
  'pilihan',
  'sd',
  'smp',
  'sma',
  'smk',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function diceCoefficient(a: string, b: string): number {
  const cleanA = a.replace(/\s+/g, '');
  const cleanB = b.replace(/\s+/g, '');
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.length < 2 || cleanB.length < 2) return 0;

  const getBigrams = (str: string): Map<string, number> => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };

  const bigramsA = getBigrams(cleanA);
  const bigramsB = getBigrams(cleanB);

  let intersection = 0;
  for (const [bg, countA] of bigramsA.entries()) {
    if (bigramsB.has(bg)) {
      intersection += Math.min(countA, bigramsB.get(bg)!);
    }
  }

  const total = (cleanA.length - 1) + (cleanB.length - 1);
  return total > 0 ? (2 * intersection) / total : 0;
}

function computeSubjectRelevance(target: string, candidate: string): number {
  const normTarget = normalizeText(target);
  const normCandidate = normalizeText(candidate);

  if (!normTarget || !normCandidate) {
    return 0;
  }

  // 1. Exact match (highest score: 60)
  if (normTarget === normCandidate) {
    return 60;
  }

  // 2. Known alias clusters match (score: 55)
  for (const cluster of ALIAS_CLUSTERS) {
    const targetInCluster = cluster.some(
      (alias) => normTarget === alias || normTarget.includes(alias) || alias.includes(normTarget)
    );
    const candidateInCluster = cluster.some(
      (alias) => normCandidate === alias || normCandidate.includes(alias) || alias.includes(normCandidate)
    );

    if (targetInCluster && candidateInCluster) {
      return 55;
    }
  }

  // 3. Substring match (score: 45)
  if (
    normTarget.length >= 3 &&
    normCandidate.length >= 3 &&
    (normCandidate.includes(normTarget) || normTarget.includes(normCandidate))
  ) {
    return 45;
  }

  // 4. Token overlap matching (score: 25 - 40)
  const targetTokens = extractTokens(normTarget);
  const candidateTokens = extractTokens(normCandidate);

  if (targetTokens.length > 0 && candidateTokens.length > 0) {
    let matchedTokenCount = 0;
    for (const tToken of targetTokens) {
      const hasMatch = candidateTokens.some(
        (cToken) =>
          cToken === tToken ||
          (tToken.length >= 4 && cToken.startsWith(tToken)) ||
          (cToken.length >= 4 && tToken.startsWith(cToken))
      );
      if (hasMatch) {
        matchedTokenCount++;
      }
    }

    if (matchedTokenCount > 0) {
      const matchRatio = matchedTokenCount / Math.max(targetTokens.length, candidateTokens.length);
      return Math.round(25 + 15 * matchRatio);
    }
  }

  // 5. String similarity / fuzzy tolerance (score: 20 - 35)
  const similarity = diceCoefficient(normTarget, normCandidate);
  if (similarity >= 0.75) {
    return 35;
  }
  if (similarity >= 0.6) {
    return 25;
  }

  // Unrelated subject
  return 0;
}

/**
 * Official CP Source Repository & Registry
 * Prioritizes official government publications (Kemendikdasmen, BSKAP, Ruang GTK).
 * Fallbacks are transparently labeled as local_reference.
 */
class CPSourceRepository {
  private registry: MasterCPEntry[] = [...ALL_MASTER_CP_ENTRIES];

  private normalizePhase(value?: string): CurriculumPhase | null {
    const phase = (value || '').trim().toUpperCase().replace(/^FASE\s+/, '');
    return ['A', 'B', 'C', 'D', 'E', 'F'].includes(phase) ? (phase as CurriculumPhase) : null;
  }

  private normalizeLevel(value?: string): SchoolLevel | null {
    const level = (value || '').trim().toUpperCase();
    return ['SD', 'SMP', 'SMA', 'SMK'].includes(level) ? (level as SchoolLevel) : null;
  }

  private mapElement(element: CPElement, parentId: string, index: number): CPElem {
    const id = element.id || `${parentId}-elem-${index + 1}`;
    return { id, code: `E${index + 1}`, name: element.name, content: element.content,
      ...(element.id ? { sourceElementKey: element.id } : {}),
      ...(element.number ? { sourceNumber: element.number } : {}),
      ...(element.sourceText !== undefined ? { sourceText: element.sourceText } : {}),
      ...(element.subelements ? { subelements: element.subelements.map((child, childIndex) => this.mapElement(child, id, childIndex)) } : {}),
    };
  }

  private mapMasterEntryToResult(
    entry: MasterCPEntry,
    context: Partial<ActiveContext>,
    options?: { conflict?: boolean; reason?: string }
  ): CPSourceSearchResult {
    const subject = entry.sourceReview ? findCP046Subject(entry.subjectCode) : findSubjectByCode(entry.subjectCode);
    const regulation = getRegulationSource(entry.regulationSourceId);
    const status = options?.conflict
      ? 'VERSION_CONFLICT'
      : normalizeCPVerificationStatus(entry.verificationStatus);
    const documentYear = regulation?.year
      ? String(regulation.year)
      : entry.implementationFromAcademicYear || context.academicYear || '';
    const sourceMeta: CPSource = {
      ...(entry.sourceReview ? { sourceReview: structuredClone(entry.sourceReview) } : {}),
      id: entry.id,
      title: regulation?.title || `Capaian Pembelajaran ${subject?.name || entry.subjectCode} Fase ${entry.phase}`,
      institution: regulation?.authority || 'Kementerian Pendidikan RI',
      documentYear,
      url: entry.sourceReview ? entry.evidence?.[0]?.sourceUrl : regulation?.sourceUrl,
      page: entry.evidence?.[0]
        ? [
            entry.evidence[0].locator?.attachment,
            entry.evidence[0].locator?.page ? `Hal. ${entry.evidence[0].locator.page}` : undefined,
            entry.evidence[0].locator?.table,
            entry.sourceReview ? entry.evidence[0].locator?.note : undefined,
          ].filter(Boolean).join(' • ')
        : `Fase ${entry.phase}`,
      retrievedAt: new Date().toISOString(),
      verificationStatus: status,
      regulationId: entry.regulationSourceId,
      regulationIds: [entry.regulationSourceId],
      versionCode: entry.id,
      subjectCode: entry.subjectCode,
      phase: entry.phase,
      level: entry.level,
      implementationFromAcademicYear: entry.implementationFromAcademicYear || null,
      implementationUntilAcademicYear: entry.implementationUntilAcademicYear || null,
    };

    return {
      id: entry.id,
      subject: subject?.name || entry.subjectCode,
      level: entry.level,
      grade: context.grade || `Fase ${entry.phase}`,
      phase: `Fase ${entry.phase}`,
      curriculum: context.curriculum || 'Kurikulum Merdeka',
      title: sourceMeta.title,
      institution: sourceMeta.institution,
      documentYear,
      url: sourceMeta.url,
      page: sourceMeta.page,
      verificationStatus: status,
      generalDescription: entry.generalDescription,
      elements: entry.elements.map((el, index) => this.mapElement(el, entry.id, index)),
      sourceMeta,
      confidenceScore: options?.conflict ? 0 : 100,
      statusReason: options?.reason || (entry.sourceReview ? entry.notes : undefined),
      isSelectable: !options?.conflict && status !== 'SUPERSEDED' && status !== 'VERSION_CONFLICT',
    };
  }

  /**
   * Search canonical CP entries by ActiveContext using strict subject, phase, level,
   * academic-year, and regulation applicability from the master registry.
   */
  public search(context: Partial<ActiveContext>, entriesPool: MasterCPEntry[] = this.registry): CPSourceSearchResult[] {
    return this.searchWithDiagnostics(context, { entriesPool }).results;
  }

  public searchWithDiagnostics(
    context: Partial<ActiveContext>,
    options: { entriesPool?: MasterCPEntry[]; academicSetting?: Partial<AcademicSetting>; sourceSet?: 'review046' } = {}
  ): CPSourceSearchReport {
    const actualContext = {
      subject: context.subject || '', level: context.level || '',
      phase: context.phase || '', academicYear: context.academicYear || '',
    };
    const unresolved = (reason: string): CPSourceSearchReport => ({ context: actualContext, status: 'UNRESOLVED', reason, results: [] });
    const rawTargetSubject = context.subject || '';
    const targetSubject = rawTargetSubject.trim();
    if (!targetSubject) {
      return unresolved('subject aktual kosong; mata pelajaran diperlukan untuk pencarian CP resmi.');
    }

    const lookup = options.sourceSet === 'review046' ? findCP046Subject : (input: string) => findSubjectByCode(input) || findSubjectByNameOrAlias(input);
    const subject = lookup(targetSubject);
    if (!subject) return unresolved('subject aktual tidak dikenali dalam katalog mata pelajaran: ' + targetSubject);

    const phase = this.normalizePhase(context.phase);
    const level = this.normalizeLevel(context.level);
    if (!phase || !level) return unresolved('level atau phase aktual kosong/tidak valid.');
    if (parseAcademicYearStart(actualContext.academicYear) === null) {
      return unresolved('academicYear aktual harus berupa tahun ajaran berurutan, misalnya 2025/2026.');
    }

    if (options.academicSetting) {
      const setting = options.academicSetting;
      const settingSubject = lookup(setting.subject || '');
      const mismatches: string[] = [];
      const compare = (field: string, same: boolean, actual: string | undefined) => {
        if (!same) mismatches.push(`${field} academicSetting="${actual || '(kosong)'}"`);
      };
      compare('subject', subject.code === settingSubject?.code, setting.subject);
      compare('level', level === this.normalizeLevel(setting.level), setting.level);
      compare('phase', phase === this.normalizePhase(setting.phase), setting.phase);
      compare('academicYear', actualContext.academicYear === setting.academicYear, setting.academicYear);
      if (mismatches.length) return unresolved('ActiveContext tidak cocok dengan academicSetting: ' + mismatches.join('; ') + '. Periksa pengaturan akademik aktif, lalu cari ulang.');
    }

    const resolution = resolveCPContext({
      subjectCode: subject.code,
      sourceSet: options.sourceSet,
      phase,
      level,
      academicYear: context.academicYear,
      entriesPool: options.entriesPool || (options.sourceSet === 'review046' ? REVIEW_CP046_ENTRIES : this.registry),
    });

    if (resolution.status === 'RESOLVED' && resolution.cp) {
      return { context: actualContext, status: 'RESOLVED', reason: 'Tepat satu sumber CP resmi sesuai context aktif.', results: [this.mapMasterEntryToResult(resolution.cp, context)] };
    }

    if (resolution.status === 'AMBIGUOUS') {
      const results = (resolution.candidates || []).map((entry) =>
        this.mapMasterEntryToResult(entry, context, { conflict: true, reason: resolution.reason })
      );
      return { context: actualContext, status: 'AMBIGUOUS', reason: resolution.reason || 'Lebih dari satu sumber CP aktif cocok dengan context.', results };
    }

    return unresolved(resolution.reason || 'Tidak ditemukan sumber CP resmi sesuai context aktif.');
  }

  /** Choices are intentionally separate from default historical resolution. */
  public searchSourceChoices(context: Partial<ActiveContext>, options: { academicSetting?: Partial<AcademicSetting> } = {}): CPSourceSearchReport {
    const historical = this.searchWithDiagnostics(context, options);
    const reviewed = this.searchWithDiagnostics(context, { ...options, sourceSet: 'review046' });
    if (!reviewed.results.length) return historical;
    const results = [...historical.results, ...reviewed.results];
    return { context: historical.context,
      status: results.some(result => result.isSelectable) ? 'RESOLVED' : 'AMBIGUOUS',
      reason: 'Pilihan sumber terpisah. Historis: ' + historical.status + '. Tambahan 046/2025 REVIEW: ' + reviewed.status + '. Pilih sumber secara eksplisit; CP tersimpan tidak diubah.',
      results };
  }

  /**
   * Returns default fallback reference if no exact match is found
   */
  public getLocalReferenceFallback(context: Partial<ActiveContext>): CPSourceSearchResult {
    const defaultPhase = context.phase || 'Fase A';
    const defaultSubject = context.subject || 'Mata Pelajaran';
    const defaultGrade = context.grade || 'Kelas 1';

    return {
      id: 'fallback-local',
      subject: defaultSubject,
      level: context.level || 'SD',
      grade: defaultGrade,
      phase: defaultPhase,
      curriculum: context.curriculum || 'Kurikulum Merdeka',
      title: `Draft Dokumen Referensi Lokal - ${defaultSubject} (${defaultPhase})`,
      institution: 'Penyusunan Mandiri Guru (Lokal)',
      documentYear: new Date().getFullYear().toString(),
      url: 'https://kurikulum.kemdikbud.go.id/',
      page: `${defaultPhase} / ${defaultGrade}`,
      verificationStatus: 'local_reference',
      generalDescription: `Pada akhir ${defaultPhase}, peserta didik menguasai kompetensi dasar ${defaultSubject} sesuai tahapan perkembangan belajar pada ${defaultGrade}.`,
      elements: [
        {
          id: 'elem-fallback-1',
          code: 'E1',
          name: 'Pemahaman Konsep & Keterampilan',
          content: `Peserta didik mampu memahami konsep esensial dan mempraktikkan keterampilan utama ${defaultSubject} secara bertahap.`,
        },
      ],
      sourceMeta: {
        title: `Draft Referensi Lokal - ${defaultSubject} (${defaultPhase})`,
        institution: 'Penyusunan Mandiri Guru (Lokal)',
        documentYear: new Date().getFullYear().toString(),
        url: 'https://kurikulum.kemdikbud.go.id/',
        page: `${defaultPhase} / ${defaultGrade}`,
        retrievedAt: new Date().toISOString(),
        verificationStatus: 'local_reference',
      },
      confidenceScore: 10,
      isSelectable: true,
    };
  }
}

export const cpSourceRepository = new CPSourceRepository();
