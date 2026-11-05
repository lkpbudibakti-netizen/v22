import { AcademicSetting } from '../types';
import { getPhaseForGrade } from '../data/curriculum/resolver';

const ROMAN_GRADE_MAP: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

function parseGradeString(str: string): number | undefined {
  const trimmed = str.trim();
  if (!trimmed) return undefined;

  // Tolak format rentang atau karakter pembagi yang ambigu (misal: "4-5", "4/5", "10A-11A")
  if (/[-/,_]/.test(trimmed)) {
    return undefined;
  }

  // 1. Pola angka Arab: opsional prefix kata (kelas|kls|grade|tingkat), lalu angka integer 1..12 secara eksak
  const arabicMatch = trimmed.match(/^(?:(?:kelas|kls|grade|tingkat)\s+)?([1-9]|1[0-2])$/i);
  if (arabicMatch) {
    const num = parseInt(arabicMatch[1], 10);
    if (!isNaN(num) && num >= 1 && num <= 12) {
      return num;
    }
  }

  // 2. Pola angka Romawi: opsional prefix kata (kelas|kls|grade|tingkat), lalu angka Romawi I..XII secara eksak
  const romanMatch = trimmed.match(/^(?:(?:kelas|kls|grade|tingkat)\s+)?(XII|XI|X|IX|VIII|VII|VI|V|IV|III|II|I)$/i);
  if (romanMatch) {
    const romanKey = romanMatch[1].toUpperCase();
    if (romanKey in ROMAN_GRADE_MAP) {
      return ROMAN_GRADE_MAP[romanKey];
    }
  }

  return undefined;
}

/**
 * Resolusi nilai kelas (grade) secara aman dan deterministik.
 * Nilai wajib berupa bilangan bulat 1 s.d. 12.
 * Jika tidak valid atau ambigu, mengembalikan undefined (FAIL-CLOSED, tanpa fallback tebakan).
 */
export function resolveGrade(
  setting?: AcademicSetting | null,
  inputGrade?: number | string
): number | undefined {
  if (inputGrade !== undefined && inputGrade !== null) {
    if (typeof inputGrade === 'number' && Number.isInteger(inputGrade) && inputGrade >= 1 && inputGrade <= 12) {
      return inputGrade;
    }
    if (typeof inputGrade === 'string') {
      return parseGradeString(inputGrade);
    }
    return undefined;
  }

  if (setting && typeof setting.grade === 'number' && Number.isInteger(setting.grade) && setting.grade >= 1 && setting.grade <= 12) {
    return setting.grade;
  }

  if (setting && typeof setting.grade === 'string') {
    return parseGradeString(setting.grade);
  }

  return undefined;
}

/**
 * Resolusi fase kurikulum resmi berdasarkan grade.
 * Menggunakan canonical getPhaseForGrade dari curriculum resolver.
 * Mengembalikan undefined jika grade tidak terdefinisi pada fase resmi.
 */
export function resolvePhaseForGrade(grade: number): string | undefined {
  const phaseCode = getPhaseForGrade(grade);
  if (!phaseCode) return undefined;
  return `Fase ${phaseCode}`;
}

export type CognitiveAbstractionLevel = 'CONCRETE' | 'CONCRETE_TO_ABSTRACT' | 'ABSTRACT_ALLOWED';
export type CognitiveLanguageLoad = 'VERY_LOW' | 'LOW' | 'MODERATE' | 'HIGH';
export type CognitiveInstructionComplexity = 'SINGLE_STEP_PREFERRED' | 'LIMITED_MULTI_STEP' | 'MULTI_STEP_ALLOWED';
export type CognitiveVisualSupport = 'STRONGLY_CONSIDER' | 'CONSIDER' | 'AS_NEEDED';
export type CognitiveScaffoldingLevel = 'HIGH' | 'MODERATE' | 'LOW';

export interface CognitiveAdaptationProfile {
  grade: number;
  phase?: string;
  abstractionLevel: 'CONCRETE' | 'CONCRETE_TO_ABSTRACT' | 'ABSTRACT_ALLOWED';
  languageLoad: 'VERY_LOW' | 'LOW' | 'MODERATE' | 'HIGH';
  instructionComplexity: 'SINGLE_STEP_PREFERRED' | 'LIMITED_MULTI_STEP' | 'MULTI_STEP_ALLOWED';
  visualSupport: 'STRONGLY_CONSIDER' | 'CONSIDER' | 'AS_NEEDED';
  scaffoldingLevel: 'HIGH' | 'MODERATE' | 'LOW';
  contextPreference?: string;
  pedagogicalGuidelines?: string[];

  // Compatibility aliases for assessment grade calibration:
  readingLoad?: 'VERY_LOW' | 'LOW' | 'MODERATE' | 'HIGH';
  instructionLoad?: 'SINGLE_STEP_PREFERRED' | 'LIMITED_MULTI_STEP' | 'MULTI_STEP_ALLOWED';
}

/**
 * Single Source of Truth (SSOT) untuk kalibrasi perkembangan kognitif
 * lintas Perencanaan Pembelajaran (Learning Plan) dan Asesmen (Assessment).
 *
 * Mengikuti prinsip:
 * 1. Pertahankan kompetensi & tuntutan proses kognitif TP (tidak menurunkan demand).
 * 2. Sesuaikan tingkat abstraksi, beban bahasa, kompleksitas instruksi, derajat scaffolding,
 *    dan dukungan visual sesuai tingkat perkembangan usia murid.
 */
export function getCognitiveAdaptationProfile(
  setting?: AcademicSetting | null,
  inputGrade?: number | string
): CognitiveAdaptationProfile | undefined {
  const grade = resolveGrade(setting, inputGrade);
  if (grade === undefined) return undefined;

  const phase = resolvePhaseForGrade(grade) || (setting?.phase ? String(setting.phase) : undefined);

  if (grade <= 2) {
    return {
      grade,
      phase: phase || 'Fase A',
      abstractionLevel: 'CONCRETE',
      languageLoad: 'VERY_LOW',
      readingLoad: 'VERY_LOW',
      instructionComplexity: 'SINGLE_STEP_PREFERRED',
      instructionLoad: 'SINGLE_STEP_PREFERRED',
      visualSupport: 'STRONGLY_CONSIDER',
      scaffoldingLevel: 'HIGH',
      contextPreference: 'PENGALAMAN_LANGSUNG_KONKRET',
      pedagogicalGuidelines: [
        'Kompetensi TP tidak boleh diturunkan, namun diwujudkan melalui pengalaman konkret, manipulatif, dan observasi langsung.',
        'Instruksi disajikan bertahap/tunggal (single-step) dengan visual pendukung yang kuat.',
        'Proses berpikir tingkat tinggi seperti ANALYZE diwujudkan melalui kegiatan mengamati, mencoba, membandingkan, memilih, mengelompokkan, dan memberi alasan sederhana secara lisan atau tindakan nyata (BUKAN diturunkan menjadi sekadar hafalan/recall).',
      ],
    };
  }

  if (grade <= 4) {
    return {
      grade,
      phase: phase || 'Fase B',
      abstractionLevel: 'CONCRETE',
      languageLoad: 'LOW',
      readingLoad: 'LOW',
      instructionComplexity: 'LIMITED_MULTI_STEP',
      instructionLoad: 'LIMITED_MULTI_STEP',
      visualSupport: 'CONSIDER',
      scaffoldingLevel: 'MODERATE',
      contextPreference: 'SEMI_KONKRET_DENGAN_PANDUAN',
      pedagogicalGuidelines: [
        'Instruksi bertahap terbatas (limited multi-step) dengan panduan visual dan scaffolding bertahap.',
        'Perbandingan terarah dan pemberian alasan sederhana didukung contoh konkret dan eksplorasi terbimbing.',
      ],
    };
  }

  if (grade <= 6) {
    return {
      grade,
      phase: phase || 'Fase C',
      abstractionLevel: 'CONCRETE_TO_ABSTRACT',
      languageLoad: 'MODERATE',
      readingLoad: 'MODERATE',
      instructionComplexity: 'LIMITED_MULTI_STEP',
      instructionLoad: 'LIMITED_MULTI_STEP',
      visualSupport: 'CONSIDER',
      scaffoldingLevel: 'MODERATE',
      contextPreference: 'SITUASI_NYATA_MENUJU_KONSEPTUAL',
      pedagogicalGuidelines: [
        'Transisi bertahap dari konteks konkret nyata menuju representasi abstrak dan sebab-akibat konseptual.',
        'Instruksi mandiri dengan refleksi terstruktur.',
      ],
    };
  }

  if (grade <= 9) {
    return {
      grade,
      phase: phase || 'Fase D',
      abstractionLevel: 'CONCRETE_TO_ABSTRACT',
      languageLoad: 'MODERATE',
      readingLoad: 'MODERATE',
      instructionComplexity: 'MULTI_STEP_ALLOWED',
      instructionLoad: 'MULTI_STEP_ALLOWED',
      visualSupport: 'AS_NEEDED',
      scaffoldingLevel: 'LOW',
      contextPreference: 'LOGIS_ANALITIS_KONSTEKSTUAL',
      pedagogicalGuidelines: [
        'Kompleksitas instruksi lebih tinggi diperbolehkan (multi-step allowed) dengan penalaran analitis dan kontekstual.',
        'Dukungan visual digunakan sesuai kebutuhan (as needed) dengan kemandirian eksplorasi.',
      ],
    };
  }

  return {
    grade,
    phase: phase || (grade === 10 ? 'Fase E' : 'Fase F'),
    abstractionLevel: 'ABSTRACT_ALLOWED',
    languageLoad: 'HIGH',
    readingLoad: 'HIGH',
    instructionComplexity: 'MULTI_STEP_ALLOWED',
    instructionLoad: 'MULTI_STEP_ALLOWED',
    visualSupport: 'AS_NEEDED',
    scaffoldingLevel: 'LOW',
    contextPreference: 'KONSEPTUAL_METAKOGNITIF_GLOBAL',
    pedagogicalGuidelines: [
      'Penyelesaian masalah kompleks, transfer konsep abstrak, dan sintesis mandiri diperbolehkan.',
    ],
  };
}
