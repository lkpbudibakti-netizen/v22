import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { scanProductionZipIdentity } from '../src/services/documentEngine/productionZipIdentity';

const packagePath = (typeof require === 'function' ? require : createRequire(import.meta.url)).resolve('pdfjs-dist/package.json');
const standardFontDataUrl = dirname(packagePath).replaceAll('\\', '/') + '/standard_fonts/';

async function readPdfText(bytes: Uint8Array): Promise<string> {
  const task = getDocument({ data: bytes, disableFontFace: true, useSystemFonts: false, standardFontDataUrl, stopAtErrors: true });
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
}

export function orderZipContainsSourceIdentity(bytes: Uint8Array, tokens: string[]): Promise<boolean> {
  return scanProductionZipIdentity(bytes, tokens, readPdfText);
}