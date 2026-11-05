import { CurriculumPhase, CurriculumRuleEvidence, SchoolLevel, VerificationStatus } from '../types';

export interface CPSourceFigure {
  id: string; elementNumber: string; pdfPage: number; assetPath: string;
  sha256: string; pdfImageName: string; width: number; height: number;
  transcription: string; alt: string;
}

export interface CPElement {
  id?: string;
  number?: string;
  sourceText?: string;
  subelements?: Array<CPElement & { id: string }>;
  name: string;
  content: string;
}

export interface MasterCPEntry {
  id: string;
  subjectCode: string;
  phase: CurriculumPhase;
  level: SchoolLevel;
  generalDescription: string;
  elements: CPElement[];
  regulationSourceId: string;
  evidence?: CurriculumRuleEvidence[];
  implementationFromAcademicYear?: string | null;
  implementationUntilAcademicYear?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  verificationStatus: VerificationStatus;
  notes?: string;
  sourceReview?: { schemaVersion: string; status: string; regulation: string; attachment: string; file: string; pdfSha256: string; section: string; subjectName: string; grades: number[]; pages: { awal: number; akhir_terdeteksi: number }; extractedText: string; recordStatus: string; figures?: CPSourceFigure[] };
}
