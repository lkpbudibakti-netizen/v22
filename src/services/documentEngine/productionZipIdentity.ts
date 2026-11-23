import JSZip from 'jszip';
import { containsSourceIdentity } from './sourceIdentityGuard';

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

/** Scan the delivered files instead of internal project metadata. */
export async function scanProductionZipIdentity(bytes: Uint8Array, tokens: string[], readPdfText: (bytes: Uint8Array) => Promise<string>): Promise<boolean> {

  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const documents = Object.values(zip.files).filter(entry => !entry.dir && /\.(pdf|docx)$/.test(entry.name));
  if (!documents.length) throw new Error('ZIP tidak memuat dokumen PDF/DOCX.');
  if (!tokens.length) return false;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (containsSourceIdentity(entry.name, tokens) ||
        containsSourceIdentity(entry.name.replace(/_/g, ' '), tokens.map(token => token.replace(/_/g, ' ')))) return true;
    if (entry.name.endsWith('.pdf') && tokens.length && containsSourceIdentity(await readPdfText(await entry.async('uint8array')), tokens)) return true;
    if (entry.name.endsWith('.docx') && tokens.length && containsSourceIdentity(await readDocxText(await entry.async('uint8array')), tokens)) return true;
  }
  return false;
}
