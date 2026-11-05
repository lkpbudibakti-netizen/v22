import { APP_BUILD_SHA, APP_BUILD_ID, APP_BUILD_DIRTY } from '../../config/buildInfo';
import { MODUL_AJAR_RENDERER_VERSION } from '../../config/modulAjarRendererVersion';
import { recordDiagnosticEvent } from '../diagnosticService';
import type { DocumentGenerationContext, DocumentSnapshot } from './types';
import type { ModulAjarProjection } from './modulAjarProjection';

export interface ModulAjarExportDiagnostic {
  buildSha: string | null;
  buildId: string;
  buildDirty: boolean | null;
  modulAjarRendererVersion: string;
  selectedLearningPlanId: string | null;
  snapshotLearningPlanId: string | null;
  meetingCount: number;
  meetingsWithActivities: number;
  totalMeetingActivities: number;
  format: 'docx' | 'pdf';
}
let lastDiagnostic: ModulAjarExportDiagnostic | null = null;
export function getLastModulAjarExportDiagnostic() { return lastDiagnostic; }
export function recordModulAjarExportDiagnostic(
  context: DocumentGenerationContext,
  projection: ModulAjarProjection,
  snapshot: DocumentSnapshot,
  format: 'docx' | 'pdf',
) {
  const meetings = projection.meetings || [];
  lastDiagnostic = {
    buildSha: APP_BUILD_SHA, buildId: APP_BUILD_ID, buildDirty: APP_BUILD_DIRTY,
    modulAjarRendererVersion: MODUL_AJAR_RENDERER_VERSION,
    selectedLearningPlanId: projection.plan?.id || context.activeLearningPlanId || null,
    snapshotLearningPlanId: snapshot.learningPlanId || null,
    meetingCount: meetings.length,
    meetingsWithActivities: meetings.filter(m => m.activities.length > 0).length,
    totalMeetingActivities: meetings.reduce((sum, m) => sum + m.activities.length, 0),
    format,
  };
  recordDiagnosticEvent({ scope: 'LEARNING_PLAN', action: 'MODUL_AJAR_EXPORTED', status: 'SUCCESS', metadata: { ...lastDiagnostic } });
  return lastDiagnostic;
}
