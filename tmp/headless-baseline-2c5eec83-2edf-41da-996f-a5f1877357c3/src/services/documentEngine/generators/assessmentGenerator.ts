import { resolveEffectiveContext } from '../snapshot';
import saveAs from 'file-saver';
import { DocumentGenerationContext, GeneratedDocumentResult } from '../types';
import { exportAssessmentDocx } from '../assessmentExportService';

export async function generateAssessment(
  context: DocumentGenerationContext
): Promise<GeneratedDocumentResult> {
  context = resolveEffectiveContext(context);


  const exportResult = await exportAssessmentDocx(context, {
    documentMode: context.documentMode,
    skipDownload: context.skipDownload,
    documentDate: context.documentDate,
  });

  if (!context.skipDownload) {
    saveAs(exportResult.blob, exportResult.fileName);
  }

  return {
    success: true,
    type: 'ASESMEN',
    title: ('Instrumen Asesmen & Rubrik Penilaian'),
    fileName: exportResult.fileName,
    blob: exportResult.blob,
    record: {
      id: `doc-asesmen-${Date.now()}`,
      type: 'ASESMEN',
      title: ('Instrumen Asesmen & Rubrik Penilaian'),
      status: 'completed',
      lastGenerated: exportResult.snapshot.generatedAt,
      fileName: exportResult.fileName,
      academicSettingId: context.academicSetting?.id,
      workspaceId: context.workspace?.id,
      snapshot: exportResult.snapshot,
    },
  };
}
