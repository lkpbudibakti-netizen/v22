import {
  WorkflowStepId,
  CurriculumType,
  AcademicSetting,
  TeacherProfile,
  SchoolData,
  AdministrationWorkspace,
  CPData,
  CPAnalysisData,
  TPData,
  TPItem,
  ATPData,
  ATPItem,
  AssessmentCriterion,
  Assessment,
  AssessmentResult,
  RemedialRecord,
  EnrichmentRecord,
  K13Analysis,
  K13KKM,
  ProfileWorkspaceData,
  UnitExecutionPlanData,
} from '../types';
import { getCurriculumTypeFromSetting } from './curriculumRouter';
import { validateAcademicSettingReadiness } from './academicSettingReadiness';
import { resolveCurriculumContext, resolveSubjectInput } from '../data/curriculum/resolver';
import { ResolvedCurriculumContext } from '../data/curriculum/types';
import { getPhaseFromGrade } from '../data/curriculumDefaults';
import { validateKKTPData, resolveCriterionTPReference, resolveATPItemTPReferences, validateTPDataWorkflow, validateCPAnalysisDataWorkflow, validateATPDataWorkflow, validateCPDataWorkflow } from './cpWorkflowService';
import { loadStorageV5, getSemesterDataV5 } from './storageV5';
import { resolveSemesterCapacityV5 } from './jpEngine';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import { resolvePlannedMeetingCapacity, isActualPlannedCapacityReady } from './subjectScheduleService';
import { isLearningMeetingScheduleReady } from './learningMeetingScheduleService';

export type WorkflowStatus = 'BLOCKED' | 'READY' | 'IN_PROGRESS' | 'COMPLETE' | 'STALE';

export interface WorkflowStepState {
  id: WorkflowStepId;
  status: WorkflowStatus;
  isBlocked: boolean;
  isComplete: boolean;
  isStale: boolean;
  reason?: string;
  missingDependencies?: string[];
}

export interface AdministrationContext {
  workspaceId: string;
  teacherProfileId: string;
  schoolId: string;
  academicYear: string;
  semester?: 1 | 2;
  curriculumType?: CurriculumType;
  level: 'SD' | 'SMP' | 'SMA' | 'SMK' | '';
  grade: number;
  rawGrade: string;
  subjectCode: string;
  subjectName: string;
  phase?: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  curriculumResolutionStatus: 'RESOLVED' | 'UNRESOLVED' | 'AMBIGUOUS';
  resolvedContext?: ResolvedCurriculumContext | null;
  unresolvedReason?: string;
}

/**
 * Builds a canonical AdministrationContext from workspace and administrative inputs.
 * Strictly avoids fake fallbacks. If any mandatory parameter is missing or invalid,
 * curriculumResolutionStatus is set to 'UNRESOLVED'.
 * Integrates directly with resolveCurriculumContext from PATCH A as single source of truth.
 */
export function buildAdministrationContext(data: {
  workspace?: AdministrationWorkspace | null;
  profile?: TeacherProfile | null;
  school?: SchoolData | null;
  academicSetting?: AcademicSetting | null;
}): AdministrationContext {
  const { workspace, profile, school, academicSetting } = data;

  const academicReadiness = validateAcademicSettingReadiness(academicSetting);
  const curriculumType: CurriculumType | undefined =
    academicReadiness.curriculumType || getCurriculumTypeFromSetting(academicSetting);

  // Extract raw inputs without injecting false default values
  const schoolId = school?.id || '';
  const teacherProfileId = profile?.id || '';
  const workspaceId = workspace?.id || '';
  const academicYear = academicSetting?.academicYear?.trim() || '';
  const semester: 1 | 2 | undefined = academicSetting?.semester === '1 (Ganjil)'
    ? 1
    : academicSetting?.semester === '2 (Genap)'
    ? 2
    : undefined;

  const rawLevel = (academicSetting?.level?.trim() || '') as 'SD' | 'SMP' | 'SMA' | 'SMK';
  const rawGrade = (academicSetting?.grade || '').trim();
  const rawSubject = academicSetting?.subject?.trim() || '';

  // Parse grade number
  const gradeMatch = rawGrade.match(/\d+/);
  const gradeNum = gradeMatch ? parseInt(gradeMatch[0], 10) : 0;

  const isSchoolMissing = !schoolId;
  const isWorkspaceMissing = !workspaceId;

  let curriculumResolutionStatus: 'RESOLVED' | 'UNRESOLVED' | 'AMBIGUOUS' = 'UNRESOLVED';
  let resolvedContext: ResolvedCurriculumContext | null = null;
  let unresolvedReason: string | undefined = undefined;
  let subjectCode = '';
  let subjectName = rawSubject;
  let phase: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | undefined = undefined;

  if (!academicReadiness.valid) {
    unresolvedReason = academicReadiness.errors[0] || 'Data Pembelajaran belum lengkap.';
  } else if (isWorkspaceMissing) {
    unresolvedReason = 'Workspace administrasi belum dipilih atau belum lengkap.';
  } else if (isSchoolMissing) {
    unresolvedReason = 'Data satuan pendidikan (sekolah) belum dipilih atau belum lengkap.';
  } else {
    // Resolve via Canonical Curriculum Resolver PATCH A
    const resolution = resolveCurriculumContext({
      curriculumType,
      academicYear,
      level: rawLevel,
      grade: gradeNum,
      subjectInput: rawSubject,
    });

    if (resolution) {
      resolvedContext = resolution;
      subjectCode = resolution.subject.code;
      subjectName = resolution.subject.name;
      phase = resolution.phase as 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
      curriculumResolutionStatus = resolution.isAmbiguous ? 'AMBIGUOUS' : 'RESOLVED';
    } else {
      unresolvedReason = `Struktur kurikulum tidak ditemukan untuk mata pelajaran '${rawSubject}' pada jenjang ${rawLevel} Kelas ${gradeNum}.`;
      curriculumResolutionStatus = 'UNRESOLVED';
    }
  }

  // If subject was not resolved through canonical curriculum structure, normalize code for display/fallback
  if (!subjectCode && rawSubject) {
    const subRes = resolveSubjectInput(rawSubject);
    subjectCode = subRes.subjectCode || rawSubject;
    subjectName = subRes.subject?.name || rawSubject;
  }

  // Derive phase if grade is valid even when curriculum structure is unresolved
  if (!phase && gradeNum >= 1 && gradeNum <= 12 && rawLevel && rawLevel !== 'SMK') {
    phase = getPhaseFromGrade(rawLevel, rawGrade).replace('Fase ', '') as 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  }

  return {
    workspaceId,
    teacherProfileId,
    schoolId,
    academicYear,
    semester,
    curriculumType,
    level: rawLevel || ('' as any),
    grade: gradeNum,
    rawGrade,
    subjectCode: subjectCode || rawSubject,
    subjectName: subjectName || rawSubject,
    phase,
    curriculumResolutionStatus,
    resolvedContext,
    unresolvedReason,
  };
}

export interface DependencyValidationIssue {
  severity: 'ERROR' | 'WARNING' | 'INFO';
  module: WorkflowStepId | 'KKTP' | 'PERENCANAAN' | 'ASESMEN' | 'TINDAK_LANJUT';
  code: string;
  message: string;
  targetId?: string;
}

export interface DependencyValidationReport {
  isValid: boolean;
  hasErrors: boolean;
  hasStaleModules: boolean;
  issues: DependencyValidationIssue[];
  stepStates: Record<WorkflowStepId, WorkflowStepState>;
  kktpState?: {
    status: WorkflowStatus;
    isBlocked: boolean;
    isComplete: boolean;
    isStale: boolean;
    hasOrphans: boolean;
  };
}

/**
 * Checks timestamp difference to detect stale upstream dependencies.
 * Returns true if upstream was modified significantly later than downstream's reference timestamp.
 */
export function isUpstreamStale(
  upstreamUpdatedAt?: string,
  downstreamReferenceUpdatedAt?: string,
  thresholdMs: number = 1000
): boolean {
  if (!upstreamUpdatedAt || !downstreamReferenceUpdatedAt) return false;
  const upstreamTime = new Date(upstreamUpdatedAt).getTime();
  const refTime = new Date(downstreamReferenceUpdatedAt).getTime();
  return upstreamTime > refTime + thresholdMs;
}

/**
 * Validates the full workflow dependency graph for a workspace.
 */
export function validateWorkflowDependencies(
  workspaceData: Partial<ProfileWorkspaceData>
): DependencyValidationReport {
  const issues: DependencyValidationIssue[] = [];

  const profile = workspaceData.profile;
  const school = workspaceData.school;
  const academicSetting = workspaceData.academicSetting;
  const cp = workspaceData.cp;
  const cpAnalysis = workspaceData.cpAnalysis;
  const tp = workspaceData.tp;
  const atp = workspaceData.atp;
  const atpUnitMapping = workspaceData.atpUnitMapping || workspaceData.activeATPUnitMapping;
  const unitExecutionPlan = workspaceData.unitExecutionPlan || workspaceData.activeUnitExecutionPlan;
  const criteria = workspaceData.assessmentCriteria || [];
  const assessments = workspaceData.assessments || [];
  const assessmentResults = workspaceData.assessmentResults || [];
  const remedials = workspaceData.remedials || [];
  const enrichments = workspaceData.enrichments || [];
  const k13Analysis = workspaceData.k13Analysis;
  const k13KKM = workspaceData.k13KKM;

  const academicReadiness = validateAcademicSettingReadiness(academicSetting);
  const isAcademicComplete = academicReadiness.valid;
  const isProfileComplete = !!profile?.name?.trim();
  const curriculumType = getCurriculumTypeFromSetting(academicSetting);
  const isK13Active = curriculumType === 'K13';

  // Step States initial map
  const stepStates: Record<WorkflowStepId, WorkflowStepState> = {
    profile: {
      id: 'profile',
      status: isProfileComplete ? 'COMPLETE' : 'IN_PROGRESS',
      isBlocked: false,
      isComplete: isProfileComplete,
      isStale: false,
    },
    academic: {
      id: 'academic',
      status: isAcademicComplete ? 'COMPLETE' : 'IN_PROGRESS',
      isBlocked: !isProfileComplete,
      isComplete: isAcademicComplete,
      isStale: false,
    },
    cp: { id: 'cp', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'cp-analysis': { id: 'cp-analysis', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    tp: { id: 'tp', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    atp: { id: 'atp', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'atp-mapping': { id: 'atp-mapping', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'annual-planning': { id: 'annual-planning', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    semester: { id: 'semester', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'k13-kd': { id: 'k13-kd', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'k13-indikator': { id: 'k13-indikator', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'k13-tujuan': { id: 'k13-tujuan', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    'k13-kkm': { id: 'k13-kkm', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
    admin: { id: 'admin', status: 'BLOCKED', isBlocked: true, isComplete: false, isStale: false },
  };

  // Base Profile & Academic Validation
  if (!isProfileComplete) {
    issues.push({
      severity: 'ERROR',
      module: 'profile',
      code: 'PROFILE_INCOMPLETE',
      message: 'Profil Guru belum lengkap (Nama Guru wajib diisi).',
    });
  }

  if (!isAcademicComplete) {
    issues.push({
      severity: 'ERROR',
      module: 'academic',
      code: 'ACADEMIC_SETTING_INCOMPLETE',
      message: academicReadiness.errors[0] || 'Pengaturan Data Pembelajaran belum lengkap.',
    });
    stepStates.academic.isBlocked = !isProfileComplete;
  }

  let kktpState: {
    status: WorkflowStatus;
    isBlocked: boolean;
    isComplete: boolean;
    isStale: boolean;
    hasOrphans: boolean;
  } = {
    status: 'BLOCKED',
    isBlocked: true,
    isComplete: false,
    isStale: false,
    hasOrphans: false,
  };

  const canEnterCurriculumWorkflow = isProfileComplete && isAcademicComplete;

  if (!canEnterCurriculumWorkflow) {
    // RECOVERY U1.3: ACADEMIC INCOMPLETE = ALL DOWNSTREAM BLOCKED
    // All downstream steps stay in their initial BLOCKED state:
    // status: 'BLOCKED', isBlocked: true, isComplete: false.
    // Existing downstream data (CP, TP, ATP, KD, etc.) in storage remains preserved,
    // but is strictly blocked and cannot be considered complete for the current workflow.
  } else if (curriculumType === 'K13') {
    // ==========================================
    // K13 WORKFLOW VALIDATION
    // ==========================================
    const kdItems = (k13Analysis?.items || []).filter((i) => i.kd && i.kd.trim().length > 0);
    const hasKD = kdItems.length > 0;

    stepStates['k13-kd'] = {
      id: 'k13-kd',
      status: hasKD ? 'COMPLETE' : stepStates.academic.isComplete ? 'READY' : 'BLOCKED',
      isBlocked: !stepStates.academic.isComplete,
      isComplete: hasKD,
      isStale: false,
    };

    const hasAnalisis = hasKD && kdItems.some((i) => (i.materi && i.materi.trim().length > 0) || (i.kegiatan && i.kegiatan.trim().length > 0));
    stepStates['k13-indikator'] = {
      id: 'k13-indikator',
      status: hasAnalisis ? 'COMPLETE' : hasKD ? 'READY' : 'BLOCKED',
      isBlocked: !hasKD,
      isComplete: hasAnalisis,
      isStale: false,
      reason: !hasKD ? 'Memerlukan data SKL/KI/KD terlebih dahulu' : undefined,
    };

    const hasTujuanIndikator = hasAnalisis && kdItems.some((i) => (i.indikator && i.indikator.trim().length > 0) || (i.tujuanPembelajaran && i.tujuanPembelajaran.trim().length > 0));
    stepStates['k13-tujuan'] = {
      id: 'k13-tujuan',
      status: hasTujuanIndikator ? 'COMPLETE' : hasAnalisis ? 'READY' : 'BLOCKED',
      isBlocked: !hasAnalisis,
      isComplete: hasTujuanIndikator,
      isStale: false,
      reason: !hasAnalisis ? 'Memerlukan Analisis KD & Materi terlebih dahulu' : undefined,
    };

    const hasKKM = !!(k13KKM?.items && k13KKM.items.length > 0);
    stepStates['k13-kkm'] = {
      id: 'k13-kkm',
      status: hasKKM ? 'COMPLETE' : hasKD ? 'READY' : 'BLOCKED',
      isBlocked: !hasKD,
      isComplete: hasKKM,
      isStale: false,
    };

    stepStates.admin = {
      id: 'admin',
      status: hasTujuanIndikator ? 'COMPLETE' : 'BLOCKED',
      isBlocked: !hasTujuanIndikator,
      isComplete: hasTujuanIndikator,
      isStale: false,
      reason: !hasTujuanIndikator ? 'Memerlukan Tujuan Pembelajaran & Indikator K13' : undefined,
    };
  } else if (curriculumType === 'KURIKULUM_MERDEKA') {
    // ==========================================
    // KURIKULUM MERDEKA WORKFLOW VALIDATION
    // ==========================================

    // 1. CP
    const cpValidation = cp ? validateCPDataWorkflow(cp, academicSetting) : undefined;
    const isCPCanonicalSiap = Boolean(cp && cpValidation?.isSiap);
    const hasCPContent = Boolean(
      (cp?.generalDescription && cp.generalDescription.trim().length > 10) ||
      (cp?.elements && cp.elements.length > 0)
    );
    const isCPComplete = isCPCanonicalSiap;

    stepStates.cp = {
      id: 'cp',
      status: isCPCanonicalSiap
        ? 'COMPLETE'
        : hasCPContent
        ? 'IN_PROGRESS'
        : stepStates.academic.isComplete
        ? 'READY'
        : 'BLOCKED',
      isBlocked: !stepStates.academic.isComplete,
      isComplete: isCPCanonicalSiap,
      isStale: false,
      reason: !isCPCanonicalSiap && hasCPContent && cpValidation?.issues[0]
        ? cpValidation.issues[0]
        : undefined,
    };

    // 2. CP Analysis (Explicit Canonical Dependency of TP)
    const cpAnalysisValidation = validateCPAnalysisDataWorkflow(cpAnalysis, cp);
    const isAnalysisCanonicalSiap = cpAnalysisValidation.isSiap;
    const isAnalysisStale =
      !!cpAnalysis?.items?.length &&
      (isUpstreamStale(cp?.updatedAt, cpAnalysis?.basedOnCpUpdatedAt) || Boolean(cpAnalysis?.needsReview));
    const analysisItems = cpAnalysis?.items || [];

    stepStates['cp-analysis'] = {
      id: 'cp-analysis',
      status: !isCPComplete
        ? 'BLOCKED'
        : isAnalysisStale
        ? 'STALE'
        : isAnalysisCanonicalSiap
        ? 'COMPLETE'
        : analysisItems.length > 0
        ? 'IN_PROGRESS'
        : 'READY',
      isBlocked: !isCPComplete,
      isComplete: isAnalysisCanonicalSiap && isCPComplete && !isAnalysisStale,
      isStale: isAnalysisStale,
      reason: !isCPComplete
        ? 'Memerlukan Capaian Pembelajaran (CP) yang berstatus SIAP terlebih dahulu'
        : isAnalysisStale
        ? cpAnalysis?.reviewReason || 'CP berubah setelah referensi Analisis CP; tinjau terhadap CP aktif.'
        : !isAnalysisCanonicalSiap && analysisItems.length > 0 && cpAnalysisValidation.issues[0]
        ? cpAnalysisValidation.issues[0]
        : undefined,
      missingDependencies: !isCPComplete ? ['Capaian Pembelajaran (CP) SIAP'] : undefined,
    };

    if (!isCPComplete && analysisItems.length > 0) {
      issues.push({
        severity: 'WARNING',
        module: 'cp-analysis',
        code: 'ORPHAN_CP_ANALYSIS',
        message: 'Analisis CP ada tetapi data CP induk belum memenuhi status SIAP.',
      });
    }

    if (isAnalysisStale) {
      issues.push({
        severity: 'INFO',
        module: 'cp-analysis',
        code: 'STALE_CP_ANALYSIS',
        message: 'Capaian Pembelajaran diperbarui setelah Analisis CP dibuat. Tinjau kembali analisis CP.',
      });
    }

    // 3. TP (Tujuan Pembelajaran - Requires CP Analysis & Canonical Validation)
    const tpItems = tp?.items || [];
    const isAnalysisReadyForTP = isCPComplete && isAnalysisCanonicalSiap && !isAnalysisStale;
    const isTPBlocked = !isAnalysisReadyForTP;
    const isTPStale =
      tpItems.length > 0 &&
      (isUpstreamStale(cpAnalysis?.updatedAt, tp?.basedOnAnalysisUpdatedAt) ||
        isUpstreamStale(cp?.updatedAt, tp?.basedOnCpUpdatedAt) ||
        Boolean(tp?.needsReview) ||
        isAnalysisStale);

    const tpValidation = !isTPBlocked && tp && tpItems.length > 0
      ? validateTPDataWorkflow(tp, cp, cpAnalysis, academicSetting)
      : null;
    const isTPDataValid = !!(tpValidation && tpValidation.isSiap);

    stepStates.tp = {
      id: 'tp',
      status: isTPBlocked
        ? 'BLOCKED'
        : isTPStale
        ? 'STALE'
        : isTPDataValid
        ? 'COMPLETE'
        : tpItems.length > 0
        ? 'IN_PROGRESS'
        : 'READY',
      isBlocked: isTPBlocked,
      isComplete: isTPDataValid && !isTPBlocked && !isTPStale,
      isStale: isTPStale,
      reason: isTPBlocked
        ? (!isAnalysisCanonicalSiap && analysisItems.length > 0 && cpAnalysisValidation.issues[0]
            ? `Analisis CP belum lengkap: ${cpAnalysisValidation.issues[0]}`
            : 'Memerlukan Analisis CP yang lengkap dan siap terlebih dahulu sebagai rujukan resmi TP')
        : isTPStale
        ? tp?.reviewReason || 'Referensi Analisis CP atau CP pada TP sudah lama; daftar TP perlu diselaraskan.'
        : !isTPDataValid && tpItems.length > 0 && tpValidation?.issues?.[0]
        ? tpValidation.issues[0]
        : undefined,
      missingDependencies: isTPBlocked ? ['Analisis CP'] : undefined,
    };

    if (tpItems.length > 0 && !isAnalysisReadyForTP) {
      issues.push({
        severity: 'WARNING',
        module: 'tp',
        code: 'TP_WITHOUT_ANALYSIS',
        message: 'Tujuan Pembelajaran dirumuskan tanpa rujukan Analisis CP yang lengkap dan siap.',
      });
    }

    if (isTPStale) {
      issues.push({
        severity: 'INFO',
        module: 'tp',
        code: 'STALE_TP',
        message: 'Analisis CP telah diperbarui. Periksa dan selaraskan rumusan TP.',
      });
    }

    if (!isTPBlocked && tpItems.length > 0 && !isTPDataValid && tpValidation) {
      tpValidation.issues.forEach((issueMsg) => {
        issues.push({
          severity: 'WARNING',
          module: 'tp',
          code: 'TP_WORKFLOW_INCOMPLETE',
          message: issueMsg,
        });
      });
    }

    // 4. ATP (Alur Tujuan Pembelajaran - Uses authoritative validateATPDataWorkflow)
    const atpItems = atp?.items || [];
    const isATPBlocked = !isTPDataValid || isTPBlocked || isTPStale;

    const isATPStale = atpItems.length > 0 && (
      isUpstreamStale(tp?.updatedAt, atp?.basedOnTpUpdatedAt) ||
      Boolean(atp?.needsReview) || isTPStale
    );

    const atpValidation = !isATPBlocked && atp && atpItems.length > 0
      ? validateATPDataWorkflow(atp, tp, academicSetting, cp, cpAnalysis)
      : null;

    const isATPComplete = !!(atpValidation && atpValidation.isSiap && !isATPBlocked && !isATPStale);

    if (atpValidation && !atpValidation.isSiap && atpItems.length > 0 && !isATPBlocked) {
      atpValidation.issues.forEach((issueMsg) => {
        const isCoverage = issueMsg.startsWith('MISSING_TP_REFERENCE') || issueMsg.includes('belum dimasukkan');
        const isDangling = issueMsg.includes('Dangling Reference') || issueMsg.includes('tidak ditemukan pada TP tersimpan');
        const isDuplicateSeq = issueMsg.includes('nomor urut duplikat') || issueMsg.includes('Duplikasi nomor urut');
        
        issues.push({
          severity: isCoverage || isDangling ? 'ERROR' : 'WARNING',
          module: 'atp',
          code: isCoverage
            ? 'MISSING_ATP_TP_COVERAGE'
            : isDangling
            ? 'ORPHAN_ATP_TP_ID'
            : isDuplicateSeq
            ? 'DUPLICATE_ATP_SEQUENCE'
            : 'ATP_WORKFLOW_INCOMPLETE',
          message: issueMsg,
        });
      });
    }

    if (isATPStale) {
      issues.push({
        severity: 'INFO',
        module: 'atp',
        code: 'STALE_ATP',
        message: 'Tujuan Pembelajaran diperbarui setelah penyusunan ATP. Alur ATP mungkin memerlukan penyesuaian.',
      });
    }

    stepStates.atp = {
      id: 'atp',
      status: isATPBlocked
        ? 'BLOCKED'
        : isATPStale
        ? 'STALE'
        : isATPComplete
        ? 'COMPLETE'
        : atpItems.length > 0
        ? 'IN_PROGRESS'
        : 'READY',
      isBlocked: isATPBlocked,
      isComplete: isATPComplete,
      isStale: isATPStale,
      reason: isATPBlocked
        ? (!isTPDataValid && tpItems.length > 0 && tpValidation?.issues?.[0]
            ? `TP acuan belum siap: ${tpValidation.issues[0]}`
            : 'Memerlukan daftar Tujuan Pembelajaran (TP) yang siap terlebih dahulu')
        : isATPStale
        ? atp?.reviewReason || 'Referensi TP pada ATP sudah lama atau TP perlu ditinjau; selaraskan ATP.'
        : !isATPComplete && atpItems.length > 0 && atpValidation?.issues?.[0]
        ? atpValidation.issues[0]
        : undefined,
      missingDependencies: isATPBlocked ? ['Tujuan Pembelajaran (TP)'] : undefined,
    };

    // 5. KKTP Validation (Standalone branch from TP -> KKTP)
    let hasOrphanCriterion = false;
    let isKKTPStale = false;

    criteria.forEach((crit) => {
      const ref = resolveCriterionTPReference(crit, tp?.items || [], k13Analysis);
      if (ref.status === 'DANGLING_REFERENCE' || ref.status === 'UNRESOLVED_REFERENCE') {
        hasOrphanCriterion = true;
        issues.push({
          severity: 'ERROR',
          module: 'KKTP',
          code: 'ORPHAN_CRITERIA_TP_ID',
          message: ref.issue || `Kriteria KKTP '${crit.id}' merujuk ke tpId '${crit.tpId || 'kosong'}' yang tidak ditemukan dalam daftar TP canonical.`,
          targetId: crit.id,
        });
      } else if (ref.status === 'AMBIGUOUS_REFERENCE') {
        hasOrphanCriterion = true;
        issues.push({
          severity: 'ERROR',
          module: 'KKTP',
          code: 'AMBIGUOUS_CRITERIA_REFERENCE',
          message: ref.issue || `Kriteria KKTP '${crit.id}' memiliki referensi TP yang ambigu.`,
          targetId: crit.id,
        });
      }

      if (isTPDataValid && (crit.needsReview || isUpstreamStale(tp?.updatedAt, crit.basedOnTpUpdatedAt))) {
        isKKTPStale = true;
      }

      if (crit.approach === 'legacy_kkm' && !isK13Active) {
        issues.push({
          severity: 'WARNING',
          module: 'KKTP',
          code: 'LEGACY_KKM_IN_MERDEKA',
          message: 'Pendekatan Legacy KKM tidak direkomendasikan sebagai kriteria utama Kurikulum Merdeka.',
          targetId: crit.id,
        });
      }
    });

    if (isKKTPStale) {
      issues.push({
        severity: 'INFO',
        module: 'KKTP',
        code: 'STALE_KKTP',
        message: 'Tujuan Pembelajaran diperbarui setelah KKTP dirumuskan. Tinjau kembali kriteria ketercapaian.',
      });
    }

    const kktpDataVal = validateKKTPData(criteria, tp, academicSetting, k13Analysis);
    const isKKTPBlocked = !isTPDataValid || isTPBlocked || isTPStale;
    const isKKTPComplete =
      isTPDataValid &&
      criteria.length > 0 &&
      !hasOrphanCriterion &&
      !isKKTPStale &&
      kktpDataVal.isSiap;

    kktpState = {
      status: isKKTPBlocked
        ? 'BLOCKED'
        : isKKTPStale
        ? 'STALE'
        : isKKTPComplete
        ? 'COMPLETE'
        : criteria.length > 0
        ? 'IN_PROGRESS'
        : 'READY',
      isBlocked: isKKTPBlocked,
      isComplete: isKKTPComplete,
      isStale: isKKTPStale,
      hasOrphans: hasOrphanCriterion,
    };

    // 5b. Pemetaan Unit/Bab step state (Canonical ATPUnitMappingData authority)
    const validAtpIds = new Set((atpItems || []).map((i) => i.id));
    const mappingUnits = atpUnitMapping?.units || [];
    const hasCanonicalMapping = Boolean(atpUnitMapping && Array.isArray(atpUnitMapping.units));
    const hasUnits = mappingUnits.length > 0;

    let hasEmptyBabTitle = false;
    let hasInvalidMaterials = false;
    let hasInvalidAtpRef = false;
    let hasDuplicateAtpAssignment = false;
    let hasUnmappedAtp = false;

    if (!hasCanonicalMapping || !hasUnits) {
      // Incomplete by default
    } else {
      const seenAtpInUnits = new Set<string>();

      for (const unit of mappingUnits) {
        if (!unit.id?.trim() || !unit.title?.trim()) {
          hasEmptyBabTitle = true;
        }

        if (!Array.isArray(unit.materials) || unit.materials.length === 0) {
          hasInvalidMaterials = true;
        } else {
          for (const mat of unit.materials) {
            if (!mat.id?.trim() || !mat.title?.trim()) {
              hasInvalidMaterials = true;
            }
            if (Array.isArray(mat.linkedAtpItemIds)) {
              for (const matAtpId of mat.linkedAtpItemIds) {
                if (matAtpId && !validAtpIds.has(matAtpId)) {
                  hasInvalidAtpRef = true;
                }
              }
            }
          }
        }

        if (Array.isArray(unit.linkedAtpItemIds)) {
          for (const atpId of unit.linkedAtpItemIds) {
            if (!atpId || !validAtpIds.has(atpId)) {
              hasInvalidAtpRef = true;
            } else {
              if (seenAtpInUnits.has(atpId)) {
                hasDuplicateAtpAssignment = true;
              }
              seenAtpInUnits.add(atpId);
            }
          }
        }
      }

      for (const validId of validAtpIds) {
        if (!seenAtpInUnits.has(validId)) {
          hasUnmappedAtp = true;
        }
      }
    }

    const isMappingStructurallyComplete =
      hasCanonicalMapping &&
      hasUnits &&
      !hasEmptyBabTitle &&
      !hasInvalidMaterials &&
      !hasInvalidAtpRef &&
      !hasDuplicateAtpAssignment &&
      !hasUnmappedAtp;

    const isMappingComplete = isATPComplete && isMappingStructurallyComplete;

    const isMappingStale =
      isATPComplete &&
      (isUpstreamStale(atp?.updatedAt, atpUnitMapping?.basedOnAtpUpdatedAt) ||
        isUpstreamStale(tp?.updatedAt, atpUnitMapping?.basedOnTpUpdatedAt));

    // Priority Reason determination
    let mappingReason: string | undefined = undefined;
    if (!isATPComplete) {
      mappingReason = 'Memerlukan penyusunan Alur Tujuan Pembelajaran (ATP) terlebih dahulu';
    } else if (isMappingStale) {
      mappingReason = 'Alur ATP telah diperbarui, pemetaan Unit/Bab perlu diselaraskan';
    } else if (!hasCanonicalMapping || !hasUnits) {
      mappingReason = 'Memerlukan pemetaan ATP ke Unit / Bab & Lingkup Materi';
    } else if (hasEmptyBabTitle) {
      mappingReason = 'Masih ada Bab tanpa judul';
    } else if (hasInvalidMaterials) {
      mappingReason = 'Masih ada Bab tanpa Lingkup Materi yang valid';
    } else if (hasInvalidAtpRef) {
      mappingReason = 'Pemetaan memiliki referensi ATP yang tidak valid';
    } else if (hasDuplicateAtpAssignment) {
      mappingReason = 'Satu atau lebih langkah ATP dipetakan ke lebih dari satu Bab';
    } else if (hasUnmappedAtp) {
      mappingReason = 'Masih ada langkah ATP yang belum dipetakan ke Bab';
    }

    if (hasInvalidAtpRef) {
      issues.push({
        severity: 'ERROR',
        module: 'atp-mapping',
        code: 'INVALID_ATP_REFERENCE_IN_MAPPING',
        message: 'Pemetaan memiliki referensi ATP yang tidak valid.',
      });
    }

    if (hasDuplicateAtpAssignment) {
      issues.push({
        severity: 'WARNING',
        module: 'atp-mapping',
        code: 'DUPLICATE_ATP_IN_MAPPING',
        message: 'Satu atau lebih langkah ATP dipetakan ke lebih dari satu Bab.',
      });
    }

    stepStates['atp-mapping'] = {
      id: 'atp-mapping',
      status: isATPBlocked
        ? 'BLOCKED'
        : !isATPComplete
        ? 'BLOCKED'
        : isMappingStale
        ? 'STALE'
        : isMappingComplete
        ? 'COMPLETE'
        : (hasUnits || hasCanonicalMapping)
        ? 'IN_PROGRESS'
        : 'READY',
      isBlocked: !isATPComplete,
      isComplete: isMappingComplete,
      isStale: isMappingStale,
      reason: mappingReason,
      missingDependencies: !isATPComplete ? ['Alur Tujuan Pembelajaran (ATP)'] : undefined,
    };

    // 5c. Perencanaan Tahunan (Kalender & JP S1 & S2) step state (Requires structurally complete Pemetaan & saved time allocations)
    let isAnnualPlanningComplete = false;
    let annualPlanningReason: string | undefined = undefined;
    let isScheduleStale = false;

    try {
      const v5State = loadStorageV5();
      const currentYearPlanId = v5State.activeYearPlanId;

      // 1. Resolve standard mapping & plan data
      const currentMapping = atpUnitMapping || (currentYearPlanId ? (v5State.annualData.atpUnitMappings || []).find((e) => e.yearPlanId === currentYearPlanId)?.value : undefined);
      const currentPlan = unitExecutionPlan || (currentYearPlanId ? (v5State.annualData.unitExecutionPlans || []).find((e) => e.yearPlanId === currentYearPlanId)?.value : undefined);
      const currentATP = atp || (currentYearPlanId ? (v5State.annualData.atp || []).find((e) => e.yearPlanId === currentYearPlanId)?.value : undefined);
      const currentTP = tp || (currentYearPlanId ? (v5State.annualData.tp || []).find((e) => e.yearPlanId === currentYearPlanId)?.value : undefined);

      // Resolve semester plans
      const sPlans = currentYearPlanId
        ? v5State.semesterPlans.filter((sp) => sp.yearPlanId === currentYearPlanId)
        : [];

      const s1 = sPlans.find(sp => sp.semester === 1);
      const s2 = sPlans.find(sp => sp.semester === 2);

      const s1Cap = s1 ? resolveSemesterCapacityV5(s1.id, v5State) : null;
      const s2Cap = s2 ? resolveSemesterCapacityV5(s2.id, v5State) : null;

      const s1Data = s1 ? getSemesterDataV5(s1.id) : null;
      const s2Data = s2 ? getSemesterDataV5(s2.id) : null;

      const s1PlannedCapacity = resolvePlannedMeetingCapacity({
        schedule: s1Data?.subjectWeeklySchedule,
        expectedWeeklyJP: s1Cap?.actualScheduledWeeklyJP ?? null,
        calendarConfirmed: Boolean(s1Cap?.isCalendarConfirmed),
        effectiveWeekSlots: s1Cap?.effectiveWeekSlots ?? 0,
        calendar: s1Data?.academicCalendar?.calendar,
        calendarDays: s1Data?.academicCalendar?.days || [],
        semesterPlanId: s1?.id,
        schoolDaysPerWeek: s1Data?.academicCalendar?.calendar?.schoolDaysPerWeek,
      });

      const s2PlannedCapacity = resolvePlannedMeetingCapacity({
        schedule: s2Data?.subjectWeeklySchedule,
        expectedWeeklyJP: s2Cap?.actualScheduledWeeklyJP ?? null,
        calendarConfirmed: Boolean(s2Cap?.isCalendarConfirmed),
        effectiveWeekSlots: s2Cap?.effectiveWeekSlots ?? 0,
        calendar: s2Data?.academicCalendar?.calendar,
        calendarDays: s2Data?.academicCalendar?.days || [],
        semesterPlanId: s2?.id,
        schoolDaysPerWeek: s2Data?.academicCalendar?.calendar?.schoolDaysPerWeek,
      });

      const s1Allocations = s1
        ? v5State.semesterData?.timeAllocation?.find((e) => e.semesterPlanId === s1.id)?.value || []
        : [];
      const s2Allocations = s2
        ? v5State.semesterData?.timeAllocation?.find((e) => e.semesterPlanId === s2.id)?.value || []
        : [];

      // Check S1 and S2 time/calendar setup ready states (Waktu S1 & Waktu S2)
      const isS1TimeReady = Boolean(s1Cap?.isReady && isActualPlannedCapacityReady(s1PlannedCapacity));
      const isS2TimeReady = Boolean(s2Cap?.isReady && isActualPlannedCapacityReady(s2PlannedCapacity));

      // Check Unit Semester Placement completeness independently (Pembagian Bab)
      let isPlacementComplete = false;
      let placementReason: string | undefined = undefined;
      let s1UnitIds: string[] = [];
      let s2UnitIds: string[] = [];

      const fallbackPlan: UnitExecutionPlanData | undefined = currentMapping
        ? {
            id: `uep-temp-${currentMapping.id}`,
            academicSettingId: currentMapping.academicSettingId,
            mappingId: currentMapping.id,
            basedOnMappingUpdatedAt: currentMapping.updatedAt,
            units: currentMapping.units.map((u) => ({ unitId: u.id, meetings: [] })),
            semesterPlacement: undefined,
            updatedAt: currentMapping.updatedAt,
          }
        : undefined;
      const effectivePlan: UnitExecutionPlanData | undefined = currentPlan || fallbackPlan;
      if (effectivePlan && currentMapping) {
        const placementVal = resolveUnitSemesterPlacement(effectivePlan, currentMapping);
        if (!placementVal.isValid || !placementVal.isComplete) {
          placementReason = 'Tetapkan pembagian Unit/Bab ke Semester 1 dan Semester 2.';
        } else {
          isPlacementComplete = true;
          s1UnitIds = placementVal.semester1UnitIds;
          s2UnitIds = placementVal.semester2UnitIds;
        }
      } else {
        placementReason = 'Tetapkan pembagian Unit/Bab ke Semester 1 dan Semester 2.';
      }

      // Check UnitExecutionPlan completeness (Struktur Pertemuan)
      let isMeetingComplete = false;
      let meetingReason: string | undefined = undefined;

      if (currentMapping && currentPlan) {
        const meetingVal = validateUnitExecutionPlan(currentPlan, currentMapping, currentATP, currentTP);
        if (meetingVal.isStale) {
          meetingReason = 'Struktur Pertemuan stale relatif terhadap Pemetaan Unit/Bab.';
        } else if (!meetingVal.isValid) {
          meetingReason = 'Struktur Pertemuan tidak valid.';
        } else if (!meetingVal.isComplete) {
          meetingReason = 'Lengkapi Struktur Pertemuan pada setiap Unit/Bab terlebih dahulu.';
        } else {
          // Meeting coverage complete! Check exact meeting count matching target slots.
          if (isPlacementComplete && s1PlannedCapacity.isReady && s2PlannedCapacity.isReady) {
            const s1UnitIdsSet = new Set(s1UnitIds);
            let s1Count = 0;
            let s2Count = 0;
            (currentPlan.units || []).forEach((u: any) => {
              const count = u.meetings?.length || 0;
              if (s1UnitIdsSet.has(u.unitId)) {
                s1Count += count;
              } else {
                s2Count += count;
              }
            });

            const s1Target = s1PlannedCapacity.totalMeetingCapacity;
            const s2Target = s2PlannedCapacity.totalMeetingCapacity;

            if (s1Count <= s1Target && s2Count <= s2Target) {
              isMeetingComplete = true;
            } else {
              meetingReason = `Jumlah Pertemuan melebihi kapasitas perencanaan (S1 ${s1Count}/${s1Target}, S2 ${s2Count}/${s2Target}).`;
            }
          } else {
            isMeetingComplete = true;
          }
        }
      } else {
        meetingReason = 'Lengkapi Struktur Pertemuan pada setiap Unit/Bab terlebih dahulu.';
      }

      // Check exact schedule readiness S1 + S2 (completion authority for Step 08 Kurikulum Merdeka)
      let isAllocationComplete = false;
      let allocationReason: string | undefined = undefined;

      if (s1 && s2) {
        const s1WeeklyJP = s1Cap?.actualScheduledWeeklyJP ?? s1Data?.semesterJPSetting?.actualScheduledWeeklyJP;
        const s2WeeklyJP = s2Cap?.actualScheduledWeeklyJP ?? s2Data?.semesterJPSetting?.actualScheduledWeeklyJP;

        const s1ScheduleReadiness = isLearningMeetingScheduleReady({
          schedule: s1Data?.learningMeetingSchedule,
          semester: 1,
          mapping: currentMapping,
          unitExecutionPlan: effectivePlan || currentPlan,
          subjectWeeklySchedule: s1Data?.subjectWeeklySchedule,
          expectedWeeklyJP: s1WeeklyJP,
          calendar: s1Data?.academicCalendar?.calendar,
          calendarDays: s1Data?.academicCalendar?.days || [],
        });

        const s2ScheduleReadiness = isLearningMeetingScheduleReady({
          schedule: s2Data?.learningMeetingSchedule,
          semester: 2,
          mapping: currentMapping,
          unitExecutionPlan: effectivePlan || currentPlan,
          subjectWeeklySchedule: s2Data?.subjectWeeklySchedule,
          expectedWeeklyJP: s2WeeklyJP,
          calendar: s2Data?.academicCalendar?.calendar,
          calendarDays: s2Data?.academicCalendar?.days || [],
        });

        isAllocationComplete = s1ScheduleReadiness.isReady && s2ScheduleReadiness.isReady;

        if (!isAllocationComplete) {
          if (s1ScheduleReadiness.isStale || s2ScheduleReadiness.isStale) {
            isScheduleStale = true;
            allocationReason = 'Jadwal Aktual berubah/stale dan perlu disusun ulang.';
          } else {
            allocationReason = 'Lengkapi dan simpan Jadwal Aktual Semester 1 dan Semester 2 terlebih dahulu.';
          }
        }
      } else {
        allocationReason = 'Lengkapi dan simpan Jadwal Aktual Semester 1 dan Semester 2 terlebih dahulu.';
      }

      // Step 08 Complete Check
      isAnnualPlanningComplete = isMappingComplete && isS1TimeReady && isS2TimeReady && isPlacementComplete && isMeetingComplete && isAllocationComplete;

      // Priority Reasons cascading
      if (!isMappingComplete) {
        annualPlanningReason = 'Memerlukan penyelesaian Pemetaan Unit/Bab & Lingkup Materi (07) terlebih dahulu';
      } else if (!isS1TimeReady) {
        annualPlanningReason = 'Waktu Semester 1: tetapkan kalender dan hari mengajar untuk slot aktual yang valid; estimasi hanya untuk draf.';
      } else if (!isS2TimeReady) {
        annualPlanningReason = 'Waktu Semester 2: tetapkan kalender dan hari mengajar untuk slot aktual yang valid; estimasi hanya untuk draf.';
      } else if (!isPlacementComplete) {
        annualPlanningReason = placementReason || 'Tetapkan pembagian Unit/Bab ke Semester 1 dan Semester 2.';
      } else if (!isMeetingComplete) {
        annualPlanningReason = meetingReason || 'Lengkapi Struktur Pertemuan sesuai kapasitas perencanaan.';
      } else if (!isAllocationComplete) {
        annualPlanningReason = allocationReason || 'Lengkapi dan simpan Jadwal Aktual Semester 1 dan Semester 2 terlebih dahulu.';
      }
    } catch {
      isAnnualPlanningComplete = false;
    }

    const isAnnualPlanningBlocked = !isMappingComplete;
    const isAnnualPlanningStale = isMappingStale || isScheduleStale;

    stepStates['annual-planning'] = {
      id: 'annual-planning',
      status: isAnnualPlanningBlocked
        ? 'BLOCKED'
        : isAnnualPlanningStale
        ? 'STALE'
        : isAnnualPlanningComplete
        ? 'COMPLETE'
        : 'READY',
      isBlocked: isAnnualPlanningBlocked,
      isComplete: isAnnualPlanningComplete && !isAnnualPlanningBlocked,
      isStale: isAnnualPlanningStale,
      reason: !isATPComplete
        ? 'Memerlukan penyusunan Alur Tujuan Pembelajaran (ATP) terlebih dahulu'
        : !isMappingComplete
        ? 'Memerlukan penyelesaian Pemetaan Unit/Bab & Lingkup Materi (07) terlebih dahulu'
        : annualPlanningReason,
      missingDependencies: !isATPComplete
        ? ['Alur Tujuan Pembelajaran (ATP)']
        : !isMappingComplete
        ? ['Pemetaan Unit/Bab & Lingkup Materi']
        : undefined,
    };

    // 6. Semester Selection step state
    const isSemesterBlocked = !isAnnualPlanningComplete || isAnnualPlanningStale;
    stepStates.semester = {
      id: 'semester',
      status: isSemesterBlocked ? 'BLOCKED' : 'READY',
      isBlocked: isSemesterBlocked,
      isComplete: false,
      isStale: isAnnualPlanningStale,
      reason: isSemesterBlocked
        ? (isMappingStale
            ? 'Pemetaan Unit/Bab berubah. Tinjau kembali Perencanaan Tahunan (08).'
            : (annualPlanningReason || 'Memerlukan penyelesaian Perencanaan Tahunan (08) terlebih dahulu'))
        : undefined,
      missingDependencies: isSemesterBlocked
        ? (isMappingStale ? ['Pemetaan Unit/Bab & Lingkup Materi'] : ['Perencanaan Tahunan (08)'])
        : undefined,
    };

    // 7. Administrasi Hub Overall Gating
    const isAdminBlocked = !isAnnualPlanningComplete || isAnnualPlanningStale;

    stepStates.admin = {
      id: 'admin',
      status: isAnnualPlanningStale
        ? 'STALE'
        : isAdminBlocked
        ? 'BLOCKED'
        : 'READY',
      isBlocked: isAdminBlocked,
      isComplete: false,
      isStale:
        isAnnualPlanningStale ||
        isATPStale ||
        isTPStale ||
        isKKTPStale,
      reason: isAnnualPlanningStale
        ? 'Rencana Tahunan berubah. Selesaikan kembali Jadwal Aktual sebelum melanjutkan administrasi semester.'
        : !isAnnualPlanningComplete
        ? 'Selesaikan Perencanaan Tahunan (08) terlebih dahulu.'
        : undefined,
    };
  } else {
    // Unresolved / unknown curriculum: all downstream branches stay BLOCKED!
    stepStates.cp.isBlocked = true;
    stepStates.cp.status = 'BLOCKED';
    stepStates['cp-analysis'].isBlocked = true;
    stepStates['cp-analysis'].status = 'BLOCKED';
    stepStates.tp.isBlocked = true;
    stepStates.tp.status = 'BLOCKED';
    stepStates.atp.isBlocked = true;
    stepStates.atp.status = 'BLOCKED';
    stepStates['atp-mapping'].isBlocked = true;
    stepStates['atp-mapping'].status = 'BLOCKED';
    stepStates['annual-planning'].isBlocked = true;
    stepStates['annual-planning'].status = 'BLOCKED';
    stepStates.semester.isBlocked = true;
    stepStates.semester.status = 'BLOCKED';
    stepStates['k13-kd'].isBlocked = true;
    stepStates['k13-kd'].status = 'BLOCKED';
    stepStates['k13-indikator'].isBlocked = true;
    stepStates['k13-indikator'].status = 'BLOCKED';
    stepStates['k13-tujuan'].isBlocked = true;
    stepStates['k13-tujuan'].status = 'BLOCKED';
    stepStates['k13-kkm'].isBlocked = true;
    stepStates['k13-kkm'].status = 'BLOCKED';
    stepStates.admin.isBlocked = true;
    stepStates.admin.status = 'BLOCKED';
    issues.push({
      severity: 'ERROR',
      module: 'academic',
      code: 'CURRICULUM_UNRESOLVED',
      message: 'Kurikulum belum ditentukan atau tidak dikenali.',
    });
  }

  const hasErrors = issues.some((i) => i.severity === 'ERROR');
  const hasStaleModules = Object.values(stepStates).some((s) => s.isStale) || kktpState.isStale;

  return {
    isValid: !hasErrors,
    hasErrors,
    hasStaleModules,
    issues,
    stepStates,
    kktpState,
  };
}

/**
 * Resolves canonical display fields for an ATPItem from canonical TP list.
 * If the ATP item has a valid tpId, canonical statement, code, materialScope, and competence are resolved.
 * If tpId is missing or not found in canonical TP list, isOrphan is strictly marked as true.
 */
export function resolveATPItemWithTP(
  item: ATPItem,
  tpList: TPItem[]
): {
  item: ATPItem;
  canonicalTP: TPItem | null;
  displayCode: string;
  displayStatement: string;
  displayMaterialScope: string;
  isOrphan: boolean;
} {
  const refRes = resolveATPItemTPReferences(item, tpList);

  if (refRes.isValid && refRes.canonicalTPItems.length > 0) {
    const primaryTP = refRes.canonicalTPItems[0];
    const codes = refRes.canonicalTPItems.map((t) => t.code).filter(Boolean);
    const statements = refRes.canonicalTPItems.map((t) => t.statement || (t as any).description).filter(Boolean);
    const scopes = refRes.canonicalTPItems.map((t) => t.contentScope).filter(Boolean);

    return {
      item,
      canonicalTP: primaryTP,
      displayCode: codes.length > 0 ? codes.join(', ') : item.tpCode || `TP ${item.stepNumber || 1}`,
      displayStatement: statements.length > 0 ? statements.join('; ') : primaryTP.statement,
      displayMaterialScope: scopes.length > 0 ? scopes.join('; ') : item.materialScope || '-',
      isOrphan: false,
    };
  }

  // If item has no valid canonical reference -> ORPHAN
  return {
    item,
    canonicalTP: null,
    displayCode: item.tpCode || `TP ${item.stepNumber || 1}`,
    displayStatement: item.tpStatement || '(Tujuan Pembelajaran tidak ditemukan dalam daftar TP)',
    displayMaterialScope: item.materialScope || '-',
    isOrphan: true,
  };
}

/**
 * Resolves canonical TP or KD for an AssessmentCriterion.
 * If criterion has no tpId or target is not found in canonical TP/KD list, isOrphan is strictly true.
 */
/**
 * Matches an ATP item or input to a canonical TP item in the TP list according to PATCH B.2 rules:
 * 1. Exact tpId match
 * 2. Exact unique tpCode match (only if matches.length === 1)
 * 3. Exact unique statement match (only if matches.length === 1)
 * 4. Otherwise -> null (UNRESOLVED / ORPHAN; ambiguous matches are NOT chosen)
 * Strictly NO positional matching (no index-based fallback).
 * Strictly NO first-item fallback.
 */
export function matchCanonicalTP(
  item: { tpId?: string; tpCode?: string; tpStatement?: string },
  tpList: TPItem[]
): TPItem | null {
  if (!tpList || tpList.length === 0) return null;

  // 1. Exact tpId match
  if (item.tpId && item.tpId.trim()) {
    const matched = tpList.find((t) => t.id === item.tpId?.trim());
    if (matched) return matched;
  }

  // 2. Exact unique tpCode match
  if (item.tpCode && item.tpCode.trim()) {
    const trimmedCode = item.tpCode.trim();
    const codeCandidates = tpList.filter((t) => t.code && t.code.trim() === trimmedCode);
    if (codeCandidates.length === 1) {
      return codeCandidates[0];
    }
    if (codeCandidates.length > 1) {
      return null; // Ambiguous: do NOT pick first match
    }
  }

  // 3. Exact unique statement match
  if (item.tpStatement && item.tpStatement.trim()) {
    const trimmedStatement = item.tpStatement.trim();
    const statementCandidates = tpList.filter((t) => t.statement && t.statement.trim() === trimmedStatement);
    if (statementCandidates.length === 1) {
      return statementCandidates[0];
    }
    if (statementCandidates.length > 1) {
      return null; // Ambiguous: do NOT pick first match
    }
  }

  return null;
}

export function resolveCriterionTarget(
  criterion: AssessmentCriterion,
  tpList: TPItem[],
  k13Analysis?: K13Analysis
): {
  targetId: string;
  targetCode: string;
  targetStatement: string;
  isOrphan: boolean;
} {
  const ref = resolveCriterionTPReference(criterion, tpList, k13Analysis);

  if (ref.status === 'RESOLVED_REFERENCE' || ref.status === 'LEGACY_MIGRATED') {
    if (ref.canonicalTPItem) {
      return {
        targetId: ref.canonicalTPItem.id,
        targetCode: ref.canonicalTPItem.code || '',
        targetStatement: ref.canonicalTPItem.statement,
        isOrphan: false,
      };
    }
    if (k13Analysis?.items && ref.tpId) {
      const matchedKD = k13Analysis.items.find((k) => k.id === ref.tpId);
      if (matchedKD) {
        return {
          targetId: matchedKD.id,
          targetCode: 'KD',
          targetStatement: matchedKD.kd,
          isOrphan: false,
        };
      }
    }
  }

  return {
    targetId: criterion.tpId || '',
    targetCode: 'UNKNOWN',
    targetStatement: criterion.description || '(Target TP/KD tidak ditemukan dalam daftar canonical)',
    isOrphan: true,
  };
}

