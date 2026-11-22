import type { AcademicSetting, ATPData, CPAnalysisData, CPData, TPData } from '../types';
import { validateATPDataWorkflow } from './cpWorkflowService';

export interface ATPFinalizationInput {
  atp: ATPData;
  tp: TPData;
  academicSetting: AcademicSetting;
  cp: CPData;
  cpAnalysis?: CPAnalysisData;
  rationale?: string;
  isAiOrigin?: boolean;
  subjectCode?: string;
  subject?: string;
  phase?: string;
  academicYear?: string;
}

export interface ATPFinalizationResult {
  canFinalize: boolean;
  candidate?: ATPData;
  issues: string[];
}

export function prepareATPFinalization(input: ATPFinalizationInput): ATPFinalizationResult {
  const {
    atp,
    tp,
    academicSetting,
    cp,
    cpAnalysis,
    rationale,
    isAiOrigin,
    subjectCode,
    subject,
    phase,
    academicYear,
  } = input;

  const candidate: ATPData = {
    ...atp,
    academicSettingId: academicSetting.id,
    tpDataId: tp.id,
    tpId: tp.id,
    academicYear,
    subjectCode: subjectCode || subject,
    phase,
    rationale: rationale ?? atp.rationale,
    items: atp.items.map((item, idx) => ({ ...item, stepNumber: idx + 1 })),
    workflowStatus: 'SIAP',
    needsReview: false,
    reviewReason: undefined,
    generatedBy: isAiOrigin ? 'AI_EDITED_BY_TEACHER' : (atp.generatedBy || 'TEACHER'),
    basedOnTpUpdatedAt: tp.updatedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const validation = validateATPDataWorkflow(candidate, tp, academicSetting, cp, cpAnalysis);
  if (!validation.isSiap) {
    return {
      canFinalize: false,
      issues: validation.issues,
    };
  }

  return {
    canFinalize: true,
    candidate,
    issues: [],
  };
}
