import saveAs from 'file-saver';
import { generateProductionPackage } from '../identityOnlyProjectExport';
import { generateZipBundle } from './zipBundle';
import type { DocumentGenerationContext, ZipExportOptions } from './types';
import { scanProductionZipIdentity } from './productionZipIdentity';

export function browserProductionZipContainsSourceIdentity(bytes: Uint8Array, tokens: string[]): Promise<boolean> {
  return scanProductionZipIdentity(bytes, tokens, async data => {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
    GlobalWorkerOptions.workerSrc = workerUrl;
    const task = getDocument({ data, stopAtErrors: true, useSystemFonts: true, disableFontFace: true });
    try {
      const pdf = await task.promise;
      const pages: string[] = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number);
        const { items } = await page.getTextContent();
        pages.push(items.flatMap(item => 'str' in item ? [item.str] : []).join(' '));
        page.cleanup();
      }
      return pages.join('\n');
    } finally {
      await task.destroy();
    }
  });
}

/** Custom selections stay manual; the default bulk export uses the package manifest. */
export async function downloadAdministrationZip(options: ZipExportOptions, context: DocumentGenerationContext) {
  if (context.workMode !== 'production' || context.zipAnnualSource?.yearPlan.identityOnlyImport?.mode !== 'IDENTITY_ONLY' ||
      (options.documentMode ?? context.documentMode) === 'blank') return generateZipBundle(options, context);
  const { result } = await generateProductionPackage(context, {
    format: options.format, types: options.types, onProgress: options.onProgress,
    containsSourceIdentity: browserProductionZipContainsSourceIdentity,
  });
  saveAs(result.zipBlob!, result.zipFileName);
  return result;
}