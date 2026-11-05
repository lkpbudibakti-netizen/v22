import type {
  AppStorageStateV5,
  AdministrationWorkspaceV5,
} from '../types/storageV5';
import type {
  AssessmentCriterion,
  AssessmentPackage,
  AssessmentPlan,
  ATPData,
  ATPItem,
  CPAnalysisData,
  CPAnalysisItem,
  CPData,
  CPElem,
  LearningPlan,
  SemesterPlan,
  TPData,
  TPItem,
  YearPlan,
} from '../types';
import type {
  AdministrationProjectPackage,
  AdministrationProjectPackageSemesterData,
  AdministrationProjectTransferIssue,
  PortableAssessmentCriterion,
  PortableAssessmentPackage,
  PortableAssessmentPlan,
  PortableATPData,
  PortableCPAnalysisData,
  PortableCPData,
  PortableLearningPlan,
  PortableTPData,
} from '../types/administrationProjectTransfer';
import {
  createInitialStorageV5,
  loadStorageV5,
  saveStorageV5,
  STORAGE_KEY_V5,
  validateStorageStateV5,
} from './storageV5';
import { validateAdministrationProjectPackage } from './administrationProjectTransferService';
import { validateAssessmentPackage } from './assessmentPackageService';
import type { CompleteProjectArchive, CompleteProjectImportOptions } from '../types/completeProjectTransfer';
import { validateATPUnitMappingCanonical } from './atpUnitMappingValidationService';
import { validateUnitExecutionPlan } from './unitExecutionPlanService';
import { resolveSemesterJPFromState } from './semesterJPResolver';
import { validateLearningMeetingScheduleData } from './learningMeetingScheduleService';
import { validateCalendarCompleteness } from './jpEngine';
import { validateSubjectWeeklySchedule } from './subjectScheduleService';
import { validateCPDataWorkflow, validateCPAnalysisDataWorkflow, validateTPDataWorkflow, validateATPDataWorkflow } from './cpWorkflowService';
import { resolveATPUnitMappingReadiness } from './atpMappingReadinessService';
import { computeAtpSubstantiveFingerprint, computeTpSubstantiveFingerprint, matchesSubstantiveFingerprint } from './atpMappingActionApplyService';
import { isValidDocumentDate } from './documentDateService';
import { buildImportedProjectExportContext, importedProjectExportReadiness } from './identityOnlyProjectExport';
import { generateZipBundle } from './documentEngine';
import { resolveAnnualZipContexts } from './documentEngine/annualZipPlan';
import { buildModulAjarProjection } from './documentEngine/modulAjarProjection';
import { validateAssessmentPlan } from './assessmentPlanService';
import { sourceIdentityExportIssue } from './documentEngine/sourceIdentityGuard';
import { ADMINISTRATION_IMPORT_MODES } from '../types/completeProjectTransfer';
import { GRADE_PHASE_MAP } from '../data/curriculumDefaults';
import { resolveGrade } from './cognitiveAdaptationService';
import { classImportCompatibility } from './administrationImportPolicy';

const cloneProject = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const externalProjectFields = new Set(['source', 'evidence', 'snapshot', 'regulationSources', 'curriculumLock']);

function visitProject(value: any, visit: (node: any) => void) {
  if (!value || typeof value !== 'object') return;
  visit(value);
  for (const [key, child] of Object.entries(value)) if (!externalProjectFields.has(key)) visitProject(child, visit);
}

export function validateCompleteProjectArchive(value: unknown): CompleteProjectArchive {
  const archive = cloneProject(value) as CompleteProjectArchive;
  if (archive?.kind !== 'ADMINISTRATION_PROJECT' || archive.schemaVersion !== '2.0') {
    throw new Error('Format proyek lengkap tidak didukung (diperlukan versi 2.0).');
  }
  const state = validateStorageStateV5(archive.project);
  if (state.yearPlans.length !== 1 || state.profiles.length !== 1 || state.schools.length !== 1) {
    throw new Error('Arsip harus berisi tepat satu proyek dan pemilik asalnya.');
  }
  const known = createInitialStorageV5();
  for (const scope of ['annualData', 'semesterData'] as const) {
    for (const key of Object.keys(state[scope])) {
      if (!Object.hasOwn(known[scope], key)) throw new Error(`Koleksi proyek belum didukung: ${scope}.${key}`);
    }
  }
  const definedIds = new Set<string>();
  const entities = [
    ...state.yearPlans, ...state.workspaces, ...state.semesterPlans,
    ...state.annualData.cp.flatMap(e => [e.value, ...e.value.elements]),
    ...state.annualData.cpAnalysis.flatMap(e => [e.value, ...e.value.items]),
    ...state.annualData.tp.flatMap(e => [e.value, ...e.value.items]),
    ...state.annualData.atp.flatMap(e => [e.value, ...e.value.items]),
    ...(state.annualData.atpUnitMappings || []).flatMap(e => [e.value, ...e.value.units.flatMap(u => [u, ...u.materials])]),
    ...(state.annualData.unitExecutionPlans || []).flatMap(e => [e.value, ...e.value.units.flatMap(u => u.meetings)]),
    ...state.semesterData.learningPlan.flatMap(e => e.value),
    ...state.semesterData.assessmentCriteria.flatMap(e => e.value),
    ...state.semesterData.assessmentPlan.flatMap(e => e.value),
    ...state.semesterData.assessmentPackage.flatMap(e => e.value),
  ];
  for (const node of entities) {
    if (typeof node.id !== 'string' || !node.id.trim()) throw new Error('Entity proyek tidak memiliki ID valid.');
    if (definedIds.has(node.id)) throw new Error(`Konflik ID di dalam arsip proyek: ${node.id}`);
    definedIds.add(node.id);
  }
  const cpIds = new Set(state.annualData.cp.map(e => e.value.id));
  const elementIds = new Set(state.annualData.cp.flatMap(e => e.value.elements.map(i => i.id)));
  const analysisIds = new Set(state.annualData.cpAnalysis.map(e => e.value.id));
  const analysisItemIds = new Set(state.annualData.cpAnalysis.flatMap(e => e.value.items.map(i => i.id)));
  const tpIds = new Set(state.annualData.tp.flatMap(e => e.value.items.map(i => i.id)));
  const atpIds = new Set(state.annualData.atp.flatMap(e => e.value.items.map(i => i.id)));
  const units = (state.annualData.atpUnitMappings || []).flatMap(e => e.value.units);
  const unitIds = new Set(units.map(u => u.id));
  const materialIds = new Set(units.flatMap(u => u.materials.map(m => m.id)));
  const meetingIds = new Set((state.annualData.unitExecutionPlans || []).flatMap(e => e.value.units.flatMap(u => u.meetings.map(m => m.id))));
  const referenceSets: Record<string, Set<string>> = {
    linkedTpIds: tpIds, tpIds, linkedAtpItemIds: atpIds, atpItemIds: atpIds,
    unitId: unitIds, materialIds, meetingId: meetingIds,
    meetingIds, unresolvedMeetingIds: meetingIds,
    atpItemId: atpIds, objectiveRefId: tpIds,
    tpId: new Set([...tpIds, ...state.annualData.tp.map(e => e.value.id)]),
    criterionIds: new Set(state.semesterData.assessmentCriteria.flatMap(e => e.value.map(i => i.id))),
    kktpCriterionIds: new Set(state.semesterData.assessmentCriteria.flatMap(e => e.value.map(i => i.id))),
    criterionId: new Set(state.semesterData.assessmentCriteria.flatMap(e => e.value.map(i => i.id))),
    learningPlanIds: new Set(state.semesterData.learningPlan.flatMap(e => e.value.map(i => i.id))),
    assessmentPlanId: new Set(state.semesterData.assessmentPlan.flatMap(e => e.value.map(i => i.id))),
    academicCalendarId: new Set(state.semesterData.academicCalendar.map(e => e.value.calendar.id)),
    cpAnalysisItemIds: analysisItemIds, elementId: elementIds,
    tpDataId: new Set(state.annualData.tp.map(e => e.value.id)),
    atpId: new Set(state.annualData.atp.map(e => e.value.id)),
    mappingId: new Set((state.annualData.atpUnitMappings || []).map(e => e.value.id)),
  };
  visitProject([state.annualData, state.semesterData], node => {
    for (const [key, ids] of Object.entries(referenceSets)) {
      if (node[key] === undefined || node[key] === null) continue;
      const refs = Array.isArray(node[key]) ? node[key] : [node[key]];
      for (const id of refs) if (!ids.has(id)) throw new Error(`Relasi proyek tidak ditemukan: ${key} [${id}].`);
    }
  });
  const checkRef = (id: string | undefined, ids: Set<string>, path: string) => {
    if (id && !ids.has(id)) throw new Error(`Relasi proyek tidak ditemukan: ${path} [${id}].`);
  };
  for (const e of state.annualData.cpAnalysis) checkRef(e.value.cpId, cpIds, 'cpAnalysis.cpId');
  for (const e of state.annualData.tp) {
    checkRef(e.value.cpId, cpIds, 'tp.cpId');
    checkRef(e.value.cpAnalysisId, analysisIds, 'tp.cpAnalysisId');
  }
  for (const e of state.annualData.atp) for (const item of e.value.items) checkRef(item.tpId, tpIds, 'atp.tpId');
  for (const e of state.semesterData.assessmentCriteria) for (const criterion of e.value) checkRef(criterion.tpId, tpIds, 'criterion.tpId');
  for (const semester of state.semesterPlans) {
    const criteria = new Set(state.semesterData.assessmentCriteria.find(e => e.semesterPlanId === semester.id)?.value.map(i => i.id) || []);
    const plans = new Set(state.semesterData.learningPlan.find(e => e.semesterPlanId === semester.id)?.value.map(i => i.id) || []);
    const assessments = new Set(state.semesterData.assessmentPlan.find(e => e.semesterPlanId === semester.id)?.value.map(i => i.id) || []);
    const semesterRefs: Record<string, Set<string>> = { criterionId: criteria, criterionIds: criteria, kktpCriterionIds: criteria,
      learningPlanIds: plans, assessmentPlanId: assessments };
    const values = Object.values(state.semesterData).flatMap(entries => entries.filter(e => e.semesterPlanId === semester.id));
    visitProject(values, node => {
      for (const [key, ids] of Object.entries(semesterRefs)) {
        const refs = node[key] == null ? [] : Array.isArray(node[key]) ? node[key] : [node[key]];
        for (const id of refs) checkRef(id, ids, `semester ${semester.semester}.${key}`);
      }
    });
  }
  const mapping = state.annualData.atpUnitMappings?.[0]?.value;
  const tp = state.annualData.tp[0]?.value;
  const atp = state.annualData.atp[0]?.value;
  const execution = state.annualData.unitExecutionPlans?.[0]?.value;
  if (mapping && tp && atp) {
    const checked = validateATPUnitMappingCanonical(mapping, atp, tp);
    if (!checked.isValid) throw new Error(`Lineage Bab/Materi invalid: ${checked.issues.join('; ')}`);
  }
  if (execution && mapping) {
    const checked = validateUnitExecutionPlan(execution, mapping, atp, tp);
    if (!checked.isValid) throw new Error(`Lineage pertemuan invalid: ${checked.errors.join('; ')}`);
  }
  return archive;
}

/** Pure preparation is used by preview and commit; no writes until every check succeeds. */
export function prepareCompleteAdministrationProjectImport(current: AppStorageStateV5, value: unknown,
  options: CompleteProjectImportOptions) {
  const archive = validateCompleteProjectArchive(value);
  const modernMode = ADMINISTRATION_IMPORT_MODES.some(item=>item.mode===options.mode);
  if (!modernMode && !['RESTORE', 'COPY'].includes(options.mode)) throw new Error('Mode import tidak dikenal.');
  if (modernMode && !isValidDocumentDate(options.documentDate)) throw new Error('Tetapkan tanggal dokumen tujuan sebelum mengganti identitas.');
  const source = archive.project;
  const sourceYear = source.yearPlans[0];
  const targetClass = options.mode === 'OTHER_CLASS' ? (GRADE_PHASE_MAP[sourceYear.level] || []).find(item=>resolveGrade(undefined,item.grade)===resolveGrade(undefined,options.targetGrade)) : undefined;
  if (options.mode === 'OTHER_CLASS' && (!targetClass || !options.targetClassSection?.trim())) throw new Error('Pilih kelas dan rombel tujuan yang valid.');
  const targetGrade = targetClass?.grade || sourceYear.grade;
  const targetSection = options.mode === 'OTHER_CLASS' ? options.targetClassSection!.trim() : sourceYear.classSection;
  if (options.mode === 'OTHER_CLASS' && resolveGrade(undefined,targetGrade)===resolveGrade(undefined,sourceYear.grade) && (targetSection || '').toUpperCase()===(sourceYear.classSection || '').toUpperCase()) throw new Error('Kelas/rombel tujuan harus berbeda dari sumber.');
  const profile = current.profiles.find(p => p.id === options.targetProfileId);
  const school = current.schools.find(s => s.id === options.targetSchoolId);
  if (!profile || !school || profile.schoolId !== school.id) throw new Error('Profil dan sekolah tujuan tidak sesuai.');
  if (options.mode === 'RESTORE' && (profile.id !== sourceYear.profileId || school.id !== sourceYear.schoolId)) {
    throw new Error('Pemulihan memerlukan profil/sekolah asal. Gunakan Salin ke Profil Lain untuk tujuan berbeda.');
  }
  const next = cloneProject(current);
  const conflict = next.yearPlans.find(y => y.profileId === profile.id && y.schoolId === school.id &&
    y.academicYear === sourceYear.academicYear && (options.mode === 'OTHER_CLASS' ? resolveGrade(undefined,y.grade)===resolveGrade(undefined,targetGrade) : y.grade === targetGrade) &&
    (y.classSection || '').toUpperCase() === (targetSection || '').toUpperCase() && y.subject.toLowerCase().trim() === sourceYear.subject.toLowerCase().trim());
  if (conflict && (options.mode !== 'RESTORE' || options.replaceYearPlanId !== conflict.id || conflict.id !== sourceYear.id)) {
    throw new Error(`Konflik proyek: ${conflict.subject} / ${conflict.grade} / ${conflict.academicYear} (${conflict.id}).`);
  }
  if (options.replaceYearPlanId && options.replaceYearPlanId !== conflict?.id) throw new Error('Persetujuan penimpaan tidak sesuai proyek konflik.');
  if (conflict) {
    const semesterIds = new Set(next.semesterPlans.filter(s => s.yearPlanId === conflict.id).map(s => s.id));
    const wsIds = new Set(next.workspaces.filter(w => w.yearPlanId === conflict.id).map(w => w.id));
    next.yearPlans = next.yearPlans.filter(y => y.id !== conflict.id);
    next.workspaces = next.workspaces.filter(w => !wsIds.has(w.id));
    next.semesterPlans = next.semesterPlans.filter(s => !semesterIds.has(s.id));
    for (const key of Object.keys(next.annualData)) (next.annualData as any)[key] = (next.annualData as any)[key].filter((e: any) => e.yearPlanId !== conflict.id);
    for (const key of Object.keys(next.semesterData)) (next.semesterData as any)[key] = (next.semesterData as any)[key].filter((e: any) => !semesterIds.has(e.semesterPlanId));
    next.annualJPReferences = next.annualJPReferences.filter(e => e.yearPlanId !== conflict.id);
    next.semesterJPSettings = next.semesterJPSettings.filter(e => !semesterIds.has(e.semesterPlanId));
    next.documents = next.documents.filter(d => !wsIds.has(d.workspaceId || '') && d.academicSettingId !== conflict.id && !semesterIds.has(d.academicSettingId || ''));
  }
  const occupied = new Set<string>();
  visitProject(next, n => { if (typeof n.id === 'string') occupied.add(n.id); });
  const idMap = new Map<string, string>([[sourceYear.profileId, profile.id], [sourceYear.schoolId, school.id]]);
  const graph = { yearPlans: source.yearPlans, workspaces: source.workspaces, semesterPlans: source.semesterPlans,
    annualJPReferences: source.annualJPReferences, semesterJPSettings: source.semesterJPSettings,
    annualData: source.annualData, semesterData: source.semesterData, documents: source.documents };
  visitProject(graph, node => {
    if (typeof node.id !== 'string' || idMap.has(node.id)) return;
    if (options.mode === 'RESTORE') {
      if (occupied.has(node.id)) throw new Error(`Konflik ID dengan proyek existing: ${node.id}`);
      idMap.set(node.id, node.id);
    } else {
      let id: string;
      do { id = `transfer-${crypto.randomUUID()}`; } while (occupied.has(id));
      occupied.add(id);
      idMap.set(node.id, id);
    }
  });
  const remap = (node: any, key = ''): any => {
    if (externalProjectFields.has(key)) return cloneProject(node);
    if (typeof node === 'string') {
      const isReference = key === 'id' || /Ids?$/.test(key) || ['tps', 'atp', 'tp'].includes(key);
      if (isReference && idMap.has(node)) return idMap.get(node);
      if (/Fingerprint$/i.test(key)) {
        try { return JSON.stringify(remap(JSON.parse(node))); } catch { return node; }
      }
      return node;
    }
    if (Array.isArray(node)) return node.map(v => remap(v, key));
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, remap(v, k)]));
    return node;
  };
  const imported = remap(graph) as typeof graph;
  const year = imported.yearPlans[0];
  if (targetClass) { year.grade = targetClass.grade; year.phase = targetClass.phase.replace(/^Fase\s*/i,''); year.classSection = targetSection; }
  const warnings: string[] = [];
  if (modernMode) {
    const identityValues = (owner: typeof profile, campus: typeof school) => [owner.name, owner.nip, campus.name, campus.npsn, campus.address, campus.principalName, campus.principalNip].filter((value): value is string => Boolean(value?.trim())).map(value => value.trim());
    const destinationValues = new Set(identityValues(profile, school).map(value => value.toLocaleLowerCase('id')));
    year.identityOnlyImport = { importedAt: new Date().toISOString(), timingIsSourceReference: true, factualDataExcluded: true,
      mode: options.mode as NonNullable<YearPlan['identityOnlyImport']>['mode'], sourceGrade: sourceYear.grade, sourcePhase: sourceYear.phase,
      sourceIdentityTokens: [...new Set([...(sourceYear.identityOnlyImport?.sourceIdentityTokens || []), ...identityValues(source.profiles[0], source.schools[0])])].filter(value => !destinationValues.has(value.toLocaleLowerCase('id'))) };
    for (const workspace of imported.workspaces) {
      workspace.documentDate = options.documentDate;
      workspace.name = `${year.subject} — ${year.grade}${year.classSection ? ' '+year.classSection : ''} — ${profile.name}`;
    }
    for (const entry of imported.semesterData.academicCalendar) entry.value.calendar.actionableMessage = 'Data sumber impor; kalender dan waktu belum diverifikasi untuk sekolah tujuan.';
    // Generated documents are regenerated with target identity; historical source snapshots stay in the source archive.
    imported.documents = [];
    visitProject([imported.annualData, imported.semesterData], node => { delete node.snapshot; });
    for (const key of ['roster', 'attendance', 'grade', 'remedial', 'enrichment', 'journalRealizations']) (imported.semesterData as any)[key] = [];
    warnings.push('Kalender, JP, jadwal, dan alokasi dipertahankan sebagai data sumber; belum diverifikasi untuk sekolah tujuan.',
      'Siswa, presensi, nilai, remedial/pengayaan, dan catatan pelaksanaan tidak disalin ke proyek tujuan. Arsip asal tetap utuh.');
    // Slot IDs contain IDs as well as dates. Rebase only exact canonical representations;
    // the unchanged full schedule validator below still detects source staleness/invalid dates/JP.
    for (const old of source.semesterData.learningMeetingSchedules || []) {
      const entry = imported.semesterData.learningMeetingSchedules?.find(item => item.semesterPlanId === idMap.get(old.semesterPlanId));
      if (!entry) continue;
      old.value.entries.forEach((slot, index) => {
        const nextSlot = entry.value.entries[index];
        if (!nextSlot) return;
        if (slot.sourceSlotId === `subject-slot:${old.semesterPlanId}:${slot.sessionId}:${slot.date}`) nextSlot.sourceSlotId = `subject-slot:${entry.semesterPlanId}:${nextSlot.sessionId}:${slot.date}`;
        if (slot.sourceSlotId === `manual-slot:${old.semesterPlanId}:${slot.meetingId}:${slot.date}:${slot.sessionId}`) nextSlot.sourceSlotId = `manual-slot:${entry.semesterPlanId}:${nextSlot.meetingId}:${slot.date}:${nextSlot.sessionId}`;
      });
    }
  }
  if (options.mode === 'COPY') {
    // Source calendars remain inspectable; dated schedules and confirmations need target-school review.
    warnings.push('Kalender, JP, pola jadwal, dan alokasi waktu disalin sebagai rujukan; konfirmasi ulang pada sekolah tujuan.');
    for (const entry of imported.semesterData.academicCalendar) {
      entry.value.calendar.workflowStatus = 'UNRESOLVED';
      entry.value.calendar.reviewStatus = 'UNREVIEWED';
      entry.value.calendar.confirmedAt = undefined;
      entry.value.calendar.reviewedAt = undefined;
      entry.value.calendar.actionableMessage = 'Tinjau kalender sekolah tujuan dan konfirmasi ulang setelah penyalinan proyek.';
    }
    for (const entry of imported.semesterData.learningMeetingSchedules || []) {
      entry.value.status = 'DRAFT';
      entry.value.unresolvedMeetingIds = Array.from(new Set([...entry.value.unresolvedMeetingIds, ...entry.value.entries.map(e => e.meetingId)]));
      entry.value.entries = [];
    }
    for (const entry of imported.semesterData.learningPlan) for (const plan of entry.value) {
      plan.status = 'DRAFT'; plan.confirmedAt = undefined;
    }
    for (const entry of imported.semesterData.assessmentPlan) for (const plan of entry.value) {
      plan.confirmedAt = undefined;
      plan.workflowStatus = 'DRAFT';
      plan.needsReview = true;
    }
    for (const entry of imported.semesterData.assessmentPackage) for (const pkg of entry.value) {
      pkg.workflowStatus = 'DRAFT';
      pkg.needsReview = true;
      pkg.reviewReason = [pkg.reviewReason, 'Tinjau perangkat asesmen pada profil/sekolah tujuan setelah import.'].filter(Boolean).join(' ');
    }
    for (const doc of imported.documents) { doc.status = 'draft'; delete doc.snapshot; }
  }
  next.yearPlans.push(...imported.yearPlans);
  next.workspaces.push(...imported.workspaces);
  next.semesterPlans.push(...imported.semesterPlans);
  next.annualJPReferences.push(...imported.annualJPReferences);
  next.semesterJPSettings.push(...imported.semesterJPSettings);
  for (const key of Object.keys(imported.annualData)) ((next.annualData as any)[key] ||= []).push(...(imported.annualData as any)[key]);
  for (const key of Object.keys(imported.semesterData)) ((next.semesterData as any)[key] ||= []).push(...(imported.semesterData as any)[key]);
  next.documents.push(...imported.documents);
  next.activeProfileId = profile.id; next.activeYearPlanId = year.id;
  next.activeWorkspaceId = imported.workspaces[0]?.id; next.activeSemesterPlanId = imported.semesterPlans[0]?.id;
  validateStorageStateV5(next);
  const mapping = imported.annualData.atpUnitMappings?.[0]?.value;
  const execution = imported.annualData.unitExecutionPlans?.[0]?.value;
  const cp = imported.annualData.cp[0]?.value;
  const analysis = imported.annualData.cpAnalysis[0]?.value;
  const tp = imported.annualData.tp[0]?.value;
  const atp = imported.annualData.atp[0]?.value;
  const sourceMapping = source.annualData.atpUnitMappings?.[0]?.value;
  const sourceTp = source.annualData.tp[0]?.value;
  const sourceAtp = source.annualData.atp[0]?.value;
  const sourceReadiness = resolveATPUnitMappingReadiness(sourceMapping, sourceAtp, sourceTp);
  // UUID remapping changes sort order inside fingerprints. Rebase only proven-fresh source snapshots.
  if (mapping && sourceMapping) {
    if (matchesSubstantiveFingerprint(sourceMapping.basedOnTpFingerprint, computeTpSubstantiveFingerprint(sourceTp))) {
      mapping.basedOnTpFingerprint = computeTpSubstantiveFingerprint(tp);
    }
    if (matchesSubstantiveFingerprint(sourceMapping.basedOnAtpFingerprint, computeAtpSubstantiveFingerprint(sourceAtp))) {
      mapping.basedOnAtpFingerprint = computeAtpSubstantiveFingerprint(atp);
    }
    const before = validateATPUnitMappingCanonical(sourceMapping, sourceAtp, sourceTp);
    const after = validateATPUnitMappingCanonical(mapping, atp, tp);
    if (before.isValid !== after.isValid || before.isComplete !== after.isComplete) {
      throw new Error('IMPORT_LINEAGE_CHANGED: kesiapan struktural Bab/Materi berubah saat remap. Import dibatalkan.');
    }
  }
  if (cp) { const check = validateCPDataWorkflow(cp, year); cp.workflowStatus = check.status; warnings.push(...check.issues); }
  if (analysis) { const check = validateCPAnalysisDataWorkflow(analysis, cp); analysis.workflowStatus = check.status; warnings.push(...check.issues); }
  if (tp) {
    const check = validateTPDataWorkflow(tp, cp, analysis);
    tp.workflowStatus = check.status === 'SIAP' && sourceTp?.workflowStatus !== 'SIAP'
      ? sourceTp?.workflowStatus || 'DRAFT' : check.status;
    warnings.push(...check.issues);
  }
  if (atp) { const check = validateATPDataWorkflow(atp, tp, undefined, cp, analysis); atp.workflowStatus = check.status; warnings.push(...check.issues); }
  if (modernMode) {
    for (const key of ['cp', 'cpAnalysis', 'tp', 'atp'] as const) {
      const before = source.annualData[key][0]?.value;
      const after = imported.annualData[key][0]?.value;
      if (after?.workflowStatus === 'SIAP' && before?.workflowStatus !== 'SIAP') after.workflowStatus = before?.workflowStatus || 'DRAFT';
    }
  }
  const compatibility = classImportCompatibility(year,cp,tp,atp);
  if (!compatibility.cpCompatible && cp) {
    cp.workflowStatus = 'PERLU_DILENGKAPI';
    if (analysis) { analysis.needsReview = true; analysis.reviewReason = compatibility.reasons[0]; analysis.workflowStatus = 'PERLU_DILENGKAPI'; }
  }
  if (!compatibility.tpCompatible && tp) { tp.needsReview = true; tp.reviewReason = compatibility.reasons.join('; '); tp.workflowStatus = 'PERLU_DILENGKAPI'; }
  if (!compatibility.atpCompatible && atp) { atp.needsReview = true; atp.reviewReason = compatibility.reasons.join('; '); atp.workflowStatus = 'PERLU_DILENGKAPI'; }
  warnings.push(...compatibility.reasons);
  if (mapping) warnings.push(...validateATPUnitMappingCanonical(mapping, imported.annualData.atp[0]?.value, imported.annualData.tp[0]?.value).issues);
  if (mapping && execution) warnings.push(...validateUnitExecutionPlan(execution, mapping, imported.annualData.atp[0]?.value, imported.annualData.tp[0]?.value).errors);
  for (const semester of imported.semesterPlans) {
    const jp = resolveSemesterJPFromState(semester.id, next).weeklyJP;
    const calendar = imported.semesterData.academicCalendar.find(e => e.semesterPlanId === semester.id)?.value;
    const weekly = imported.semesterData.subjectWeeklySchedules?.find(e => e.semesterPlanId === semester.id)?.value;
    const schedule = imported.semesterData.learningMeetingSchedules?.find(e => e.semesterPlanId === semester.id)?.value;
    if (!jp || !calendar || !weekly) warnings.push(`Semester ${semester.semester}: kalender/JP/jadwal mingguan belum lengkap.`);
    if (calendar) {
      const checked = validateCalendarCompleteness(calendar.calendar, calendar.days);
      if (!checked.complete) {
        warnings.push(`Semester ${semester.semester}: ${checked.diagnostic}`);
        calendar.calendar.workflowStatus = 'UNRESOLVED';
        calendar.calendar.confirmedAt = undefined;
      }
    }
    if (weekly) warnings.push(...validateSubjectWeeklySchedule(weekly, jp).errors);
    if (schedule && mapping && execution && calendar && weekly && jp) {
      const checked = validateLearningMeetingScheduleData({ data: schedule, semester: semester.semester, mapping,
        unitExecutionPlan: execution, subjectWeeklySchedule: weekly, expectedWeeklyJP: jp, calendar: calendar.calendar, calendarDays: calendar.days });
      warnings.push(...checked.errors);
      if (!checked.isValid || checked.isStale) schedule.status = 'DRAFT';
    }
  }
  if (modernMode) {
    const base = buildImportedProjectExportContext(next, year.id);
    const upstreamMapping = resolveATPUnitMappingReadiness(mapping, atp, tp);
    for (const { context } of resolveAnnualZipContexts(base).semesters) {
      for (const plan of context.learningPlans || []) {
        if (plan.status !== 'SIAP') continue;
        const checked = buildModulAjarProjection({ ...context, learningPlans: [plan], activeLearningPlanId: plan.id });
        const identityIssue = sourceIdentityExportIssue('MODUL_AJAR', { ...context, activeLearningPlanId: plan.id });
        const gradeIssue = options.mode==='OTHER_CLASS' && plan.cognitiveAdaptation && plan.cognitiveAdaptation.grade !== resolveGrade(undefined,year.grade) ? 'Kalibrasi kelas Modul Ajar berbeda dari kelas tujuan; tinjau perangkat ini.' : '';
        if (!checked.isReady || !upstreamMapping.canProceed || identityIssue || gradeIssue) { plan.status = 'DRAFT'; plan.confirmedAt = undefined; warnings.push(`Modul Ajar ${plan.title || plan.id}: ${gradeIssue || identityIssue || checked.error || upstreamMapping.blockers.join('; ')}`); }
      }
      for (const plan of context.assessmentPlans || []) {
        const checked = validateAssessmentPlan(plan, { academicSetting: context.academicSetting, tp, assessmentCriteria: context.assessmentCriteria, learningPlans: context.learningPlans });
        if (!checked.valid && plan.workflowStatus === 'SIAP') { plan.workflowStatus = 'DRAFT'; plan.needsReview = true; warnings.push(...checked.errors); }
      }
      for (const pkg of context.assessmentPackages || []) {
        const checked = validateAssessmentPackage(pkg, { academicSetting: context.academicSetting, tp, assessmentCriteria: context.assessmentCriteria, assessmentPlan: context.assessmentPlans?.find(plan => plan.id === pkg.assessmentPlanId) });
        const identityIssue = sourceIdentityExportIssue('ASESMEN', { ...context, activeAssessmentPackageId: pkg.id });
        if ((!checked.valid || identityIssue) && pkg.workflowStatus === 'SIAP') { pkg.workflowStatus = 'DRAFT'; pkg.needsReview = true; warnings.push(...checked.errors, ...(identityIssue ? [identityIssue] : [])); }
      }
    }
  }
  if (options.mode === 'IDENTITY_SCHEDULE') {
    // Keep proven-valid content/statuses. Target approval is pending only for time dependencies.
    for (const entry of imported.semesterData.academicCalendar) { entry.value.calendar.workflowStatus = 'UNRESOLVED'; entry.value.calendar.reviewStatus = 'UNREVIEWED'; entry.value.calendar.confirmedAt = undefined; entry.value.calendar.reviewedAt = undefined; }
    for (const entry of imported.semesterJPSettings) entry.value.source = 'UNRESOLVED';
    warnings.push('Tinjau dan simpan kalender, JP, serta jadwal pertemuan tujuan di perencanaan waktu. CP/TP/ATP dan instrumen yang tidak berubah tetap dipertahankan.');
  }
  const targetReadiness = resolveATPUnitMappingReadiness(mapping, atp, tp);
  const origin = !sourceReadiness.validationResult?.isComplete ? 'SOURCE_INCOMPLETE'
    : targetReadiness.canProceed ? 'READY' : 'UPSTREAM_REVIEW';
  if (!targetReadiness.canProceed) {
    warnings.push(origin === 'SOURCE_INCOMPLETE'
      ? 'Step 07 sudah belum lengkap pada proyek asal; import mempertahankan relasinya tanpa menambah TP/ATP.'
      : 'Cakupan Bab/Materi tetap sama; Step 07 memerlukan peninjauan status/freshness TP/ATP.');
    warnings.push(...targetReadiness.blockers);
  }
  const nextStep = !compatibility.cpCompatible || cp?.workflowStatus !== 'SIAP' ? 'cp' : analysis?.workflowStatus !== 'SIAP' ? 'cp-analysis' : tp?.workflowStatus !== 'SIAP' ? 'tp' : atp?.workflowStatus !== 'SIAP' ? 'atp' : !targetReadiness.canProceed ? 'atp-mapping' : options.mode === 'IDENTITY_SCHEDULE' ? 'annual-planning' : 'admin';
  return { state: next, yearPlanId: year.id, mode: options.mode, nextStep, compatibility, warnings: Array.from(new Set(warnings)),
    step7: { origin, source: sourceReadiness, target: targetReadiness } };
}

export function importCompleteAdministrationProject(value: unknown, options: CompleteProjectImportOptions,
  persist: (state: AppStorageStateV5) => void = saveStorageV5) {
  const prepared = prepareCompleteAdministrationProjectImport(loadStorageV5(), value, options);
  persist(prepared.state);
  return prepared;
}

/** One user action, one atomic import, then the existing document ZIP engine. Export failure never repeats import. */
export async function importCompleteAdministrationProjectAndExport(value: unknown, options: CompleteProjectImportOptions,
  exporter: typeof generateZipBundle = generateZipBundle) {
  const imported = importCompleteAdministrationProject(value, options);
  try {
    const ready = importedProjectExportReadiness(imported.state, imported.yearPlanId);
    const zipResult = await exporter({ types: ready.types, format: 'both', documentMode: 'data' }, ready.context);
    return { imported, zipResult, exportError: '' };
  } catch (error) {
    return { imported, zipResult: undefined, exportError: error instanceof Error ? error.message : 'Impor tersimpan, tetapi ZIP dokumen belum berhasil dibuat.' };
  }
}

export interface AdministrationProjectImportParams {
  package: AdministrationProjectPackage;
  targetProfileId: string;
  targetSchoolId: string;
  targetClassSection?: string;
}

export interface AdministrationProjectImportSuccess {
  success: true;
  yearPlanId: string;
  workspaceId: string;
  semesterPlanIds: {
    semester1: string;
    semester2: string;
  };
  remapSummary: {
    tpItemCount: number;
    atpItemCount: number;
    learningPlanCount: number;
    assessmentCriterionCount: number;
    assessmentPlanCount: number;
    assessmentPackageCount: number;
  };
}

export interface AdministrationProjectImportFailure {
  success: false;
  errorCode: string;
  message: string;
  issues?: AdministrationProjectTransferIssue[] | ImportIssue[];
}

export interface ImportIssue {
  code: string;
  message: string;
  path?: string;
  refId?: string;
}

export type AdministrationProjectImportResult =
  | AdministrationProjectImportSuccess
  | AdministrationProjectImportFailure;

interface ImportContext {
  now: string;
  yearPlan: YearPlan;
  workspace: AdministrationWorkspaceV5;
  semesterPlansByNumber: Map<1 | 2, SemesterPlan>;
  cpIdMap: Map<string, string>;
  cpElementIdMap: Map<string, string>;
  cpAnalysisIdMap: Map<string, string>;
  cpAnalysisItemIdMap: Map<string, string>;
  tpDataIdMap: Map<string, string>;
  tpItemIdMap: Map<string, string>;
  atpDataIdMap: Map<string, string>;
  atpItemIdMap: Map<string, string>;
  learningPlanIdMap: Map<string, string>;
  criterionIdMap: Map<string, string>;
  assessmentPlanIdMap: Map<string, string>;
  assessmentPackageIdMap: Map<string, string>;
  issues: ImportIssue[];
}

export function importAdministrationProject(
  params: AdministrationProjectImportParams
): AdministrationProjectImportResult {
  const packageValidation = validateAdministrationProjectPackage(params.package);
  if (!packageValidation.valid) {
    return {
      success: false,
      errorCode: 'PACKAGE_VALIDATION_FAILED',
      message: 'AdministrationProjectPackage gagal validasi. Import dibatalkan.',
      issues: packageValidation.issues,
    };
  }

  try {
    const currentState = loadStorageV5();
    return importAdministrationProjectIntoState(currentState, params);
  } catch (err: any) {
    return {
      success: false,
      errorCode: 'STORAGE_READ_FAILED',
      message: err?.message || 'Gagal membaca data penyimpanan storage V5.',
    };
  }
}

export function importAdministrationProjectIntoState(
  currentState: AppStorageStateV5,
  params: AdministrationProjectImportParams
): AdministrationProjectImportResult {
  const packageValidation = validateAdministrationProjectPackage(params.package);
  if (!packageValidation.valid) {
    return {
      success: false,
      errorCode: 'PACKAGE_VALIDATION_FAILED',
      message: 'AdministrationProjectPackage gagal validasi. Import dibatalkan.',
      issues: packageValidation.issues,
    };
  }

  const targetProfile = currentState.profiles.find((profile) => profile.id === params.targetProfileId);
  if (!targetProfile) {
    return failure('TARGET_PROFILE_NOT_FOUND', `Target profile [${params.targetProfileId}] tidak ditemukan.`);
  }

  const targetSchool = currentState.schools.find((school) => school.id === params.targetSchoolId);
  if (!targetSchool) {
    return failure('TARGET_SCHOOL_NOT_FOUND', `Target school [${params.targetSchoolId}] tidak ditemukan.`);
  }
  if (targetProfile.schoolId && targetProfile.schoolId !== targetSchool.id) {
    return failure(
      'TARGET_PROFILE_SCHOOL_MISMATCH',
      `Target profile [${targetProfile.id}] tidak terhubung dengan target school [${targetSchool.id}].`
    );
  }

  const targetClassSection =
    params.targetClassSection !== undefined
      ? (params.targetClassSection.trim() || undefined)
      : params.package.header.classSection;

  const duplicate = currentState.yearPlans.find(
    (yearPlan) =>
      yearPlan.profileId === params.targetProfileId &&
      yearPlan.schoolId === params.targetSchoolId &&
      yearPlan.academicYear === params.package.header.academicYear &&
      yearPlan.grade === params.package.header.grade &&
      (yearPlan.classSection || '') === (targetClassSection || '') &&
      yearPlan.subject.trim().toLowerCase() === params.package.header.subject.trim().toLowerCase()
  );
  if (duplicate) {
    return failure(
      'DUPLICATE_PROJECT',
      `Project target dengan identitas yang sama sudah ada: YearPlan [${duplicate.id}].`
    );
  }

  const nextState = clone(currentState);
  const context = createImportContext(params.package, params.targetProfileId, params.targetSchoolId, targetClassSection);

  const annualResult = buildAnnualData(params.package, context);
  const semesterResults = ([1, 2] as const).map((semester) =>
    buildSemesterData(params.package, semester, context)
  );

  if (context.issues.length > 0) {
    return {
      success: false,
      errorCode: 'REFERENCE_REMAP_FAILED',
      message: 'Import dibatalkan karena ada reference wajib yang tidak dapat diremap.',
      issues: context.issues,
    };
  }

  nextState.yearPlans.push(context.yearPlan);
  nextState.workspaces.push(context.workspace);
  nextState.semesterPlans.push(...Array.from(context.semesterPlansByNumber.values()));
  nextState.activeProfileId = params.targetProfileId;
  nextState.activeYearPlanId = context.yearPlan.id;
  nextState.activeWorkspaceId = context.workspace.id;
  nextState.activeSemesterPlanId = undefined;

  if (annualResult.cp) nextState.annualData.cp.push({ yearPlanId: context.yearPlan.id, value: annualResult.cp });
  if (annualResult.cpAnalysis) {
    nextState.annualData.cpAnalysis.push({ yearPlanId: context.yearPlan.id, value: annualResult.cpAnalysis });
  }
  if (annualResult.tp) nextState.annualData.tp.push({ yearPlanId: context.yearPlan.id, value: annualResult.tp });
  if (annualResult.atp) nextState.annualData.atp.push({ yearPlanId: context.yearPlan.id, value: annualResult.atp });

  semesterResults.forEach((result) => {
    const semesterPlan = context.semesterPlansByNumber.get(result.semester)!;
    nextState.semesterData.learningPlan.push({
      semesterPlanId: semesterPlan.id,
      value: result.learningPlans,
    });
    nextState.semesterData.assessmentCriteria.push({
      semesterPlanId: semesterPlan.id,
      value: result.assessmentCriteria,
    });
    nextState.semesterData.assessmentPlan.push({
      semesterPlanId: semesterPlan.id,
      value: result.assessmentPlans,
    });
    nextState.semesterData.assessmentPackage.push({
      semesterPlanId: semesterPlan.id,
      value: result.assessmentPackages,
    });
  });

  const assessmentIssues = validateImportedAssessmentPackages(
    semesterResults,
    context.yearPlan,
    annualResult.tp
  );
  if (assessmentIssues.length > 0) {
    return {
      success: false,
      errorCode: 'ASSESSMENT_PACKAGE_VALIDATION_FAILED',
      message: 'Import dibatalkan karena validasi AssessmentPackage hasil remap gagal.',
      issues: assessmentIssues,
    };
  }

  try {
    validateStorageStateV5(nextState);
    saveStorageV5(nextState);
  } catch (err) {
    return failure(
      'STORAGE_VALIDATION_FAILED',
      err instanceof Error ? err.message : 'Validasi Storage V5 gagal. Import dibatalkan.'
    );
  }

  return {
    success: true,
    yearPlanId: context.yearPlan.id,
    workspaceId: context.workspace.id,
    semesterPlanIds: {
      semester1: context.semesterPlansByNumber.get(1)!.id,
      semester2: context.semesterPlansByNumber.get(2)!.id,
    },
    remapSummary: {
      tpItemCount: context.tpItemIdMap.size,
      atpItemCount: context.atpItemIdMap.size,
      learningPlanCount: context.learningPlanIdMap.size,
      assessmentCriterionCount: context.criterionIdMap.size,
      assessmentPlanCount: context.assessmentPlanIdMap.size,
      assessmentPackageCount: context.assessmentPackageIdMap.size,
    },
  };
}

function createImportContext(
  pkg: AdministrationProjectPackage,
  profileId: string,
  schoolId: string,
  classSection?: string
): ImportContext {
  const now = new Date().toISOString();
  const yearPlanId = newId('yp');
  const workspaceId = newId('ws');
  const semesterPlan1Id = newId('sp1');
  const semesterPlan2Id = newId('sp2');

  const yearPlan: YearPlan = {
    id: yearPlanId,
    profileId,
    schoolId,
    academicYear: pkg.header.academicYear,
    curriculumType: pkg.header.curriculumType,
    level: pkg.header.level,
    grade: pkg.header.grade,
    ...(classSection !== undefined ? { classSection } : {}),
    subject: pkg.header.subject,
    phase: pkg.header.phase,
    createdAt: now,
    updatedAt: now,
  };

  const workspace: AdministrationWorkspaceV5 = {
    id: workspaceId,
    profileId,
    schoolId,
    yearPlanId,
    name: `${pkg.header.subject} - ${pkg.header.grade} (${pkg.header.academicYear})`,
    createdAt: now,
    updatedAt: now,
  };

  return {
    now,
    yearPlan,
    workspace,
    semesterPlansByNumber: new Map([
      [1, { id: semesterPlan1Id, yearPlanId, semester: 1, createdAt: now, updatedAt: now }],
      [2, { id: semesterPlan2Id, yearPlanId, semester: 2, createdAt: now, updatedAt: now }],
    ]),
    cpIdMap: new Map(),
    cpElementIdMap: new Map(),
    cpAnalysisIdMap: new Map(),
    cpAnalysisItemIdMap: new Map(),
    tpDataIdMap: new Map(),
    tpItemIdMap: new Map(),
    atpDataIdMap: new Map(),
    atpItemIdMap: new Map(),
    learningPlanIdMap: new Map(),
    criterionIdMap: new Map(),
    assessmentPlanIdMap: new Map(),
    assessmentPackageIdMap: new Map(),
    issues: [],
  };
}

function buildAnnualData(
  pkg: AdministrationProjectPackage,
  context: ImportContext
): {
  cp?: CPData;
  cpAnalysis?: CPAnalysisData;
  tp?: TPData;
  atp?: ATPData;
} {
  assertSingleAnnualEntity(pkg.annual.cp, 'annual.cp', context);
  assertSingleAnnualEntity(pkg.annual.cpAnalysis || [], 'annual.cpAnalysis', context);
  assertSingleAnnualEntity(pkg.annual.tp, 'annual.tp', context);
  assertSingleAnnualEntity(pkg.annual.atp, 'annual.atp', context);

  const cp = pkg.annual.cp[0] ? remapCP(pkg.annual.cp[0], context) : undefined;
  const cpAnalysis = pkg.annual.cpAnalysis?.[0]
    ? remapCPAnalysis(pkg.annual.cpAnalysis[0], context)
    : undefined;
  const tp = pkg.annual.tp[0] ? remapTP(pkg.annual.tp[0], context) : undefined;
  const atp = pkg.annual.atp[0] ? remapATP(pkg.annual.atp[0], context) : undefined;

  return { cp, cpAnalysis, tp, atp };
}

function buildSemesterData(
  pkg: AdministrationProjectPackage,
  semester: 1 | 2,
  context: ImportContext
): {
  semester: 1 | 2;
  learningPlans: LearningPlan[];
  assessmentCriteria: AssessmentCriterion[];
  assessmentPlans: AssessmentPlan[];
  assessmentPackages: AssessmentPackage[];
} {
  const source = pkg.semesters.find((entry) => entry.semester === semester);
  if (!source) {
    return {
      semester,
      learningPlans: [],
      assessmentCriteria: [],
      assessmentPlans: [],
      assessmentPackages: [],
    };
  }

  registerSemesterMaps(source, context);

  const assessmentCriteria = source.assessmentCriteria.map((criterion, index) =>
    remapAssessmentCriterion(criterion, context, `semesters.${semester}.assessmentCriteria[${index}]`)
  );
  const learningPlans = source.learningPlans.map((plan, index) =>
    remapLearningPlan(plan, context, `semesters.${semester}.learningPlans[${index}]`)
  );
  const assessmentPlans = source.assessmentPlans.map((plan, index) =>
    remapAssessmentPlan(plan, context, `semesters.${semester}.assessmentPlans[${index}]`)
  );
  const assessmentPackages = source.assessmentPackages.map((assessmentPackage, index) =>
    remapAssessmentPackage(assessmentPackage, context, `semesters.${semester}.assessmentPackages[${index}]`)
  );

  return {
    semester,
    learningPlans,
    assessmentCriteria,
    assessmentPlans,
    assessmentPackages,
  };
}

function registerSemesterMaps(source: AdministrationProjectPackageSemesterData, context: ImportContext): void {
  source.learningPlans.forEach((plan) => {
    context.learningPlanIdMap.set(plan.id, newId('lp'));
  });
  source.assessmentCriteria.forEach((criterion) => {
    context.criterionIdMap.set(criterion.id, newId('kktp'));
  });
  source.assessmentPlans.forEach((plan) => {
    context.assessmentPlanIdMap.set(plan.id, newId('ap'));
  });
  source.assessmentPackages.forEach((assessmentPackage) => {
    context.assessmentPackageIdMap.set(assessmentPackage.id, newId('pkg'));
  });
}

function remapCP(source: PortableCPData, context: ImportContext): CPData {
  const cp = clone(source) as CPData;
  const oldId = source.id;
  const newCpId = newId('cp');
  context.cpIdMap.set(oldId, newCpId);
  cp.id = newCpId;
  cp.academicSettingId = context.yearPlan.id;
  cp.elements = (source.elements || []).map((element) => {
    const next = clone(element) as CPElem;
    const newElementId = newId('cpe');
    context.cpElementIdMap.set(element.id, newElementId);
    next.id = newElementId;
    return next;
  });
  cp.updatedAt = context.now;
  return cp;
}

function remapCPAnalysis(source: PortableCPAnalysisData, context: ImportContext): CPAnalysisData {
  const cpAnalysis = clone(source) as CPAnalysisData;
  const oldId = source.id;
  const newAnalysisId = newId('cpa');
  context.cpAnalysisIdMap.set(oldId, newAnalysisId);
  cpAnalysis.id = newAnalysisId;
  cpAnalysis.academicSettingId = context.yearPlan.id;
  cpAnalysis.workspaceId = context.workspace.id;
  cpAnalysis.cpId = remapOptional(source.cpId, context.cpIdMap, context, 'annual.cpAnalysis.cpId');
  cpAnalysis.items = (source.items || []).map((item) => {
    const next = clone(item) as CPAnalysisItem;
    const newItemId = newId('cpai');
    context.cpAnalysisItemIdMap.set(item.id, newItemId);
    next.id = newItemId;
    next.elementId = remapOptional(item.elementId, context.cpElementIdMap, context, 'annual.cpAnalysis.items.elementId');
    return next;
  });
  cpAnalysis.updatedAt = context.now;
  return cpAnalysis;
}

function remapTP(source: PortableTPData, context: ImportContext): TPData {
  const tp = clone(source) as TPData;
  context.tpDataIdMap.set(source.id, newId('tpd'));
  tp.id = context.tpDataIdMap.get(source.id)!;
  tp.academicSettingId = context.yearPlan.id;
  tp.workspaceId = context.workspace.id;
  tp.cpId = remapOptional(source.cpId, context.cpIdMap, context, 'annual.tp.cpId');
  tp.cpAnalysisId = remapOptional(source.cpAnalysisId, context.cpAnalysisIdMap, context, 'annual.tp.cpAnalysisId');
  tp.items = (source.items || []).map((item) => {
    const next = clone(item) as TPItem;
    const newItemId = newId('tp');
    context.tpItemIdMap.set(item.id, newItemId);
    next.id = newItemId;
    next.cpAnalysisId = remapOptional(item.cpAnalysisId, context.cpAnalysisItemIdMap, context, 'annual.tp.items.cpAnalysisId');
    next.cpAnalysisItemIds = remapOptionalArray(
      item.cpAnalysisItemIds,
      context.cpAnalysisItemIdMap,
      context,
      'annual.tp.items.cpAnalysisItemIds'
    );
    return next;
  });
  tp.updatedAt = context.now;
  return tp;
}

function remapATP(source: PortableATPData, context: ImportContext): ATPData {
  const atp = clone(source) as ATPData;
  context.atpDataIdMap.set(source.id, newId('atpd'));
  atp.id = context.atpDataIdMap.get(source.id)!;
  atp.academicSettingId = context.yearPlan.id;
  atp.workspaceId = context.workspace.id;
  atp.tpId = remapOptional(source.tpId, context.tpItemIdMap, context, 'annual.atp.tpId');
  atp.tpDataId = remapOptional(source.tpDataId, context.tpDataIdMap, context, 'annual.atp.tpDataId');
  atp.items = (source.items || []).map((item, index) =>
    remapATPItem(item, context, `annual.atp.items[${index}]`)
  );
  atp.updatedAt = context.now;
  return atp;
}

function remapATPItem(source: ATPItem, context: ImportContext, path: string): ATPItem {
  const item = clone(source) as ATPItem;
  const newItemId = newId('atpi');
  context.atpItemIdMap.set(source.id, newItemId);
  item.id = newItemId;
  item.tpId = requireMapped(source.tpId, context.tpItemIdMap, context, `${path}.tpId`);
  return item;
}

function remapLearningPlan(source: PortableLearningPlan, context: ImportContext, path: string): LearningPlan {
  const plan = clone(source) as LearningPlan;
  plan.id = requireMapped(source.id, context.learningPlanIdMap, context, `${path}.id`);
  plan.academicSettingId = context.yearPlan.id;
  plan.curriculumType = context.yearPlan.curriculumType;
  plan.status = 'DRAFT';
  plan.tpIds = remapRequiredArray(source.tpIds, context.tpItemIdMap, context, `${path}.tpIds`);
  plan.atpItemIds = remapRequiredArray(source.atpItemIds, context.atpItemIdMap, context, `${path}.atpItemIds`);
  plan.kktpCriterionIds = remapOptionalArray(source.kktpCriterionIds, context.criterionIdMap, context, `${path}.kktpCriterionIds`);
  plan.timeAllocationIds = [];
  plan.objectives = (source.objectives || []).map((objective, index) => ({
    ...clone(objective),
    tpId: remapOptional(objective.tpId, context.tpItemIdMap, context, `${path}.objectives[${index}].tpId`),
  }));
  plan.learningExperiences = source.learningExperiences?.map((experience, index) => ({
    ...clone(experience),
    linkedTpIds: remapOptionalArray(
      experience.linkedTpIds,
      context.tpItemIdMap,
      context,
      `${path}.learningExperiences[${index}].linkedTpIds`
    ),
  }));
  plan.assessmentPlan = {
    initial: remapLearningAssessmentItems(source.assessmentPlan?.initial, context, `${path}.assessmentPlan.initial`),
    formative: remapLearningAssessmentItems(source.assessmentPlan?.formative, context, `${path}.assessmentPlan.formative`),
    summative: remapLearningAssessmentItems(source.assessmentPlan?.summative, context, `${path}.assessmentPlan.summative`),
  };
  plan.reflection = {
    ...(plan.reflection || {}),
    teacherReflection: appendReviewNote(
      plan.reflection?.teacherReflection,
      'Hasil import perlu review karena konteks target dan alokasi waktu belum direkonsiliasi.'
    ),
  };
  plan.confirmedAt = undefined;
  plan.updatedAt = context.now;
  return plan;
}

function remapLearningAssessmentItems(
  items: LearningPlan['assessmentPlan']['initial'] | undefined,
  context: ImportContext,
  path: string
): LearningPlan['assessmentPlan']['initial'] {
  return items?.map((item, index) => ({
    ...clone(item),
    linkedTpIds: remapRequiredArray(item.linkedTpIds, context.tpItemIdMap, context, `${path}[${index}].linkedTpIds`),
  }));
}

function remapAssessmentCriterion(
  source: PortableAssessmentCriterion,
  context: ImportContext,
  path: string
): AssessmentCriterion {
  const criterion = clone(source) as AssessmentCriterion;
  criterion.id = requireMapped(source.id, context.criterionIdMap, context, `${path}.id`);
  criterion.academicSettingId = context.yearPlan.id;
  criterion.workspaceId = context.workspace.id;
  criterion.tpId = requireMapped(source.tpId, context.tpItemIdMap, context, `${path}.tpId`);
  criterion.updatedAt = context.now;
  return criterion;
}

function remapAssessmentPlan(source: PortableAssessmentPlan, context: ImportContext, path: string): AssessmentPlan {
  const plan = clone(source) as AssessmentPlan;
  plan.id = requireMapped(source.id, context.assessmentPlanIdMap, context, `${path}.id`);
  plan.academicSettingId = context.yearPlan.id;
  plan.workspaceId = context.workspace.id;
  plan.tpIds = remapRequiredArray(source.tpIds, context.tpItemIdMap, context, `${path}.tpIds`);
  plan.criterionIds = remapRequiredArray(source.criterionIds, context.criterionIdMap, context, `${path}.criterionIds`);
  plan.learningPlanIds = remapOptionalArray(source.learningPlanIds, context.learningPlanIdMap, context, `${path}.learningPlanIds`);
  plan.confirmedAt = undefined;
  plan.updatedAt = context.now;
  return plan;
}

function remapAssessmentPackage(
  source: PortableAssessmentPackage,
  context: ImportContext,
  path: string
): AssessmentPackage {
  const assessmentPackage = clone(source) as AssessmentPackage;
  assessmentPackage.id = requireMapped(source.id, context.assessmentPackageIdMap, context, `${path}.id`);
  assessmentPackage.assessmentPlanId = requireMapped(
    source.assessmentPlanId,
    context.assessmentPlanIdMap,
    context,
    `${path}.assessmentPlanId`
  );
  assessmentPackage.academicSettingId = context.yearPlan.id;
  assessmentPackage.workspaceId = context.workspace.id;
  assessmentPackage.blueprintItems = (source.blueprintItems || []).map((item, index) => ({
    ...clone(item),
    objectiveRefId: requireMapped(
      item.objectiveRefId,
      context.tpItemIdMap,
      context,
      `${path}.blueprintItems[${index}].objectiveRefId`
    ),
    criterionId: remapOptional(
      item.criterionId,
      context.criterionIdMap,
      context,
      `${path}.blueprintItems[${index}].criterionId`
    ),
  }));
  assessmentPackage.updatedAt = context.now;
  return assessmentPackage;
}

function validateImportedAssessmentPackages(
  semesterResults: Array<{
    assessmentCriteria: AssessmentCriterion[];
    assessmentPlans: AssessmentPlan[];
    assessmentPackages: AssessmentPackage[];
  }>,
  yearPlan: YearPlan,
  tp?: TPData
): ImportIssue[] {
  const issues: ImportIssue[] = [];
  semesterResults.forEach((semesterResult, semesterIndex) => {
    semesterResult.assessmentPackages.forEach((assessmentPackage) => {
      const assessmentPlan = semesterResult.assessmentPlans.find(
        (candidate) => candidate.id === assessmentPackage.assessmentPlanId
      );
      const validation = validateAssessmentPackage(assessmentPackage, {
        academicSetting: {
          id: yearPlan.id,
          profileId: yearPlan.profileId,
          curriculum: yearPlan.curriculumType === 'K13' ? 'Kurikulum 2013' : 'Kurikulum Merdeka',
          curriculumType: yearPlan.curriculumType,
          academicYear: yearPlan.academicYear,
          semester: '',
          level: yearPlan.level,
          grade: yearPlan.grade,
          phase: yearPlan.phase || '',
          subject: yearPlan.subject,
          updatedAt: '',
        },
        assessmentPlan: assessmentPlan
          ? {
              ...assessmentPlan,
              workflowStatus: 'SIAP',
              needsReview: false,
            }
          : undefined,
        assessmentCriteria: semesterResult.assessmentCriteria,
        tp,
      });
      validation.errors.forEach((message) => {
        issues.push({
          code: 'ASSESSMENT_PACKAGE_INVALID',
          message,
          path: `semesters[${semesterIndex}].assessmentPackages.${assessmentPackage.id}`,
        });
      });
    });
  });
  return issues;
}

function readStorageV5Snapshot():
  | { success: true; state: AppStorageStateV5 }
  | AdministrationProjectImportFailure {
  if (typeof localStorage === 'undefined') {
    return { success: true, state: createInitialStorageV5() };
  }

  const raw = localStorage.getItem(STORAGE_KEY_V5);
  if (raw === null) {
    return { success: true, state: createInitialStorageV5() };
  }

  try {
    return { success: true, state: validateStorageStateV5(JSON.parse(raw)) };
  } catch (err) {
    return failure(
      'STORAGE_READ_FAILED',
      err instanceof Error ? err.message : 'Storage V5 tidak dapat dibaca.'
    );
  }
}

function assertSingleAnnualEntity(values: unknown[] | undefined, path: string, context: ImportContext): void {
  if ((values || []).length > 1) {
    context.issues.push({
      code: 'UNSUPPORTED_MULTIPLE_ANNUAL_ENTITY',
      message: `${path} berisi lebih dari satu entity. Import Core saat ini hanya menerima satu wrapper V5 per annual collection.`,
      path,
    });
  }
}

function remapRequiredArray(
  ids: string[] | undefined,
  map: Map<string, string>,
  context: ImportContext,
  path: string
): string[] {
  return (ids || []).map((id, index) => requireMapped(id, map, context, `${path}[${index}]`));
}

function remapOptionalArray(
  ids: string[] | undefined,
  map: Map<string, string>,
  context?: ImportContext,
  path?: string
): string[] | undefined {
  if (!ids) return undefined;
  return ids.map((id, index) =>
    context && path ? requireMapped(id, map, context, `${path}[${index}]`) : map.get(id) || id
  );
}

function remapOptional(
  id: string | undefined,
  map: Map<string, string>,
  context?: ImportContext,
  path?: string
): string | undefined {
  if (!id) return undefined;
  const mapped = map.get(id);
  if (!mapped && context && path) {
    context.issues.push({
      code: 'MISSING_REFERENCE_MAP',
      message: `Reference [${id}] tidak memiliki mapping.`,
      path,
      refId: id,
    });
  }
  return mapped || id;
}

function requireMapped(
  id: string | undefined,
  map: Map<string, string>,
  context: ImportContext,
  path: string
): string {
  if (!id) {
    context.issues.push({
      code: 'MISSING_REQUIRED_REFERENCE',
      message: `Reference wajib kosong pada ${path}.`,
      path,
    });
    return '';
  }
  const mapped = map.get(id);
  if (!mapped) {
    context.issues.push({
      code: 'MISSING_REFERENCE_MAP',
      message: `Reference [${id}] tidak memiliki mapping.`,
      path,
      refId: id,
    });
    return id;
  }
  return mapped;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function appendReviewNote(existing: string | undefined, note: string): string {
  if (!existing || existing.trim() === '') return note;
  if (existing.includes(note)) return existing;
  return `${existing}\n${note}`;
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function failure(errorCode: string, message: string): AdministrationProjectImportFailure {
  return {
    success: false,
    errorCode,
    message,
  };
}
