import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import JSZip from 'jszip';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { containsSourceIdentity } from '../src/services/documentEngine/sourceIdentityGuard';

const packagePath = (typeof require === 'function' ? require : createRequire(import.meta.url)).resolve('pdfjs-dist/package.json');
const standardFontDataUrl = dirname(packagePath).replaceAll('\\', '/') + '/standard_fonts/';

const xmlEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

async function readDocxText(bytes: Uint8Array): Promise<string[]> {
  const archive = await JSZip.loadAsync(bytes);
  const parts = Object.values(archive.files).filter(entry =>
    /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(entry.name));
  return await Promise.all(parts.map(async part => {
    const xml = await part.async('string');
    return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([paragraph]) =>
      [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)\b[^>]*\/>/g)]
        .map(([, text]) => text === undefined ? ' ' : text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
          (_, entity: string) => entity.startsWith('#x') ? String.fromCodePoint(parseInt(entity.slice(2), 16))
            : entity.startsWith('#') ? String.fromCodePoint(Number(entity.slice(1))) : xmlEntities[entity]))
        .join('')).join('\n');
  }));
}

async function pdfContainsIdentity(bytes: Uint8Array, tokens: string[]): Promise<boolean> {
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
    return containsSourceIdentity(pages.join('\n'), tokens);
  } finally {
    await task.destroy();
  }
}

/** Scan the delivered files instead of internal project metadata. */
export async function orderZipContainsSourceIdentity(bytes: Uint8Array, tokens: string[]): Promise<boolean> {
  if (!tokens.length) return false;
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (containsSourceIdentity(entry.name, tokens) ||
        containsSourceIdentity(entry.name.replace(/_/g, ' '), tokens.map(token => token.replace(/_/g, ' ')))) return true;
    if (entry.name.endsWith('.pdf') && await pdfContainsIdentity(await entry.async('uint8array'), tokens)) return true;
    if (entry.name.endsWith('.docx') && containsSourceIdentity(await readDocxText(await entry.async('uint8array')), tokens)) return true;
  }
  return false;
}
