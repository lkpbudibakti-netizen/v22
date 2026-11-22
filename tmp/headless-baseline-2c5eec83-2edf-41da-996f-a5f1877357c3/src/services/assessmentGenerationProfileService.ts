import {
  AcademicSetting,
  AssessmentGenerationProfile,
  AssessmentGradeCalibrationProfile,
  AssessmentReferenceProgression,
  AssessmentGenerationRule,
} from '../types';
import {
  resolveGrade,
  resolvePhaseForGrade,
  getCognitiveAdaptationProfile,
  CognitiveAdaptationProfile,
} from './cognitiveAdaptationService';

export { resolveGrade, resolvePhaseForGrade, getCognitiveAdaptationProfile };
export type { CognitiveAdaptationProfile };

/**
 * Resolusi progresi kerangka rujukan resmi AKM (Pusmendik BSKAP).
 * Perlakukan sebagai OFFICIAL_REFERENCE, bukan aturan universal asesmen.
 * DILARANG digunakan untuk menentukan HOTS, difficulty, skor, atau jumlah soal secara otomatis.
 */
export function resolveAKMProgression(grade: number): AssessmentReferenceProgression | undefined {
  if (grade < 1 || grade > 12) return undefined;

  let level: 1 | 2 | 3 | 4 | 5 | 6;
  if (grade === 1 || grade === 2) level = 1;
  else if (grade === 3 || grade === 4) level = 2;
  else if (grade === 5 || grade === 6) level = 3;
  else if (grade === 7 || grade === 8) level = 4;
  else if (grade === 9 || grade === 10) level = 5;
  else level = 6; // 11 - 12

  return {
    framework: 'AKM',
    level,
    sourceType: 'OFFICIAL_REFERENCE',
  };
}

/**
 * Profil kalibrasi perkembangan kognitif dan beban bacaan per jenjang kelas.
 * Bertindak sebagai panduan (guidance), mendelegasikan ke SSOT Cognitive Adaptation.
 */
export function getGradeCalibrationProfile(grade: number): AssessmentGradeCalibrationProfile {
  const adaptation = getCognitiveAdaptationProfile(null, grade) || {
    grade,
    readingLoad: 'HIGH' as const,
    languageLoad: 'HIGH' as const,
    instructionLoad: 'MULTI_STEP_ALLOWED' as const,
    instructionComplexity: 'MULTI_STEP_ALLOWED' as const,
    abstractionLevel: 'ABSTRACT_ALLOWED' as const,
    visualSupport: 'AS_NEEDED' as const,
    scaffoldingLevel: 'LOW' as const,
  };

  const rules: AssessmentGenerationRule[] = [
    {
      id: `RULE-GRADE-CALIB-${grade}`,
      sourceType: 'PEDAGOGICAL_RULE',
      description: `Kalibrasi kompleksitas instruksi dan stimulus asesmen untuk kelas ${grade} berdasarkan kaidah perkembangan kognitif dan beban bacaan peserta didik.`,
      sourceTitle: 'Kaidah Pedagogis Kompleksitas Instruksi dan Beban Bacaan Peserta Didik',
    },
  ];

  return {
    grade,
    readingLoad: adaptation.readingLoad || adaptation.languageLoad,
    instructionLoad: adaptation.instructionLoad || adaptation.instructionComplexity,
    abstractionLevel: adaptation.abstractionLevel,
    visualSupport: adaptation.visualSupport,
    rules,
  };
}

/**
 * Pembangun Profil Asesmen Generasi (AssessmentGenerationProfile).
 */
export function createAssessmentGenerationProfile(grade: number): AssessmentGenerationProfile {
  const phase = resolvePhaseForGrade(grade);
  const akmProgression = resolveAKMProgression(grade);
  const gradeCalibration = getGradeCalibrationProfile(grade);

  const provenance: AssessmentGenerationRule[] = [
    {
      id: 'PROV-PHASE-OFFICIAL',
      sourceType: 'OFFICIAL',
      description: 'Penetapan Fase Capaian Pembelajaran Kurikulum Merdeka berdasarkan jenjang kelas.',
      sourceTitle: 'Keputusan Kepala BSKAP No. 032/H/KR/2024',
      sourceAgency: 'Kemendikbudristek',
      sourceVersion: '2024',
    },
  ];

  if (akmProgression) {
    provenance.push({
      id: 'PROV-AKM-PROGRESSION',
      sourceType: 'OFFICIAL_REFERENCE',
      description: `Rujukan Level Progresi Asesmen Kompetensi Minimum (AKM Level ${akmProgression.level}) untuk kelas ${grade}.`,
      sourceTitle: 'Kerangka Asesmen Kompetensi Minimum (AKM)',
      sourceAgency: 'Pusat Asesmen Pendidikan (Pusmendik) BSKAP',
      sourceVersion: '2020/2024',
    });
  }

  return {
    grade,
    phase,
    referenceProgression: akmProgression,
    gradeCalibration,
    provenance,
  };
}
