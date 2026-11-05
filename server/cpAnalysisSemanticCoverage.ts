export const cpStopWords = new Set([
  'peserta', 'didik', 'mampu', 'fase', 'elemen', 'cp', 'tp',
  'dan', 'atau', 'serta', 'yang', 'di', 'ke', 'dari', 'pada', 'dalam',
  'untuk', 'dengan', 'sebagai', 'oleh', 'tentang', 'bagi', 'secara',
  'baik', 'seperti', 'melalui', 'agar', 'supaya', 'harus', 'dapat',
  'akan', 'telah', 'adalah', 'merupakan', 'yaitu', 'yakni', 'dsb', 'dll',
  'pesertadidik', 'memahami', 'mempraktikkan', 'menerapkan', 'mengidentifikasi'
]);

export function getSubstantiveTokens(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.filter(w => w.length > 2 && !cpStopWords.has(w));
}

export function checkSemanticCoverage(baselineItems: any[], sanitizedItems: any[]): boolean {
  for (const bItem of baselineItems) {
    const bElemId = bItem.elementId ? String(bItem.elementId).trim() : '';
    if (!bElemId) continue;
    const materialScope = bItem.materialScope || '';
    
    // Split baseline.materialScope into conservative chunks by ';' and 'serta'
    const chunks = materialScope.split(/;|\bserta\b/i).map(c => c.trim()).filter(Boolean);
    if (chunks.length === 0) continue;

    const geminiItemsForElem = sanitizedItems.filter(i => i.elementId === bElemId);
    const geminiTextPool = geminiItemsForElem.map(i => `${i.cpCompetence} ${i.materialScope} ${i.meaningfulUnderstanding} ${i.suggestedTp}`).join(' ');
    const geminiTokens = new Set(getSubstantiveTokens(geminiTextPool));

    for (const chunk of chunks) {
      const chunkTokens = getSubstantiveTokens(chunk);
      if (chunkTokens.length === 0) continue;

      const matched = chunkTokens.filter(t => geminiTokens.has(t));
      if (chunkTokens.length <= 5) {
        if (matched.length < chunkTokens.length) {
          return false;
        }
      } else {
        const minOverlap = Math.max(2, Math.ceil(0.7 * chunkTokens.length));
        if (matched.length < minOverlap) {
          return false;
        }
      }
    }
  }
  return true;
}
