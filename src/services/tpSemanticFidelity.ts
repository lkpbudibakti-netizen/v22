export const tpStopWords = new Set([
  'peserta', 'didik', 'mampu', 'fase', 'elemen', 'cp', 'tp',
  'dan', 'atau', 'serta', 'yang', 'di', 'ke', 'dari', 'pada', 'dalam',
  'untuk', 'dengan', 'sebagai', 'oleh', 'tentang', 'bagi', 'secara',
  'baik', 'seperti', 'melalui', 'agar', 'supaya', 'harus', 'dapat',
  'akan', 'telah', 'adalah', 'merupakan', 'yaitu', 'yakni', 'dsb', 'dll',
  'pesertadidik'
]);

export function getSubstantiveTokens(text: string): string[] {
  if (!text) return [];
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.filter(w => w.length > 2 && !tpStopWords.has(w));
}

export function checkIndividualTPRelevance(tpItem: any, analysisItem: any): boolean {
  if (!tpItem || !analysisItem) return false;
  
  const tpTextPool = [
    tpItem.competence || tpItem.competency || '',
    tpItem.contentScope || '',
    tpItem.statement || tpItem.description || '',
  ].join(' ');

  const analysisTextPool = [
    analysisItem.cpCompetence || '',
    analysisItem.materialScope || '',
  ].join(' ');

  const tpTokens = new Set(getSubstantiveTokens(tpTextPool));
  const analysisTokens = getSubstantiveTokens(analysisTextPool);

  if (analysisTokens.length === 0) {
    return tpTokens.size > 0;
  }

  // Check if there is substantive overlap towards cpCompetence OR materialScope
  const overlap = analysisTokens.filter(t => tpTokens.has(t));
  return overlap.length > 0;
}

export function checkAggregateTPCoverage(tpItemsForAnalysis: any[], analysisItem: any): boolean {
  return getUncoveredTPChunks(tpItemsForAnalysis, analysisItem).length === 0;
}

export function getUncoveredTPChunks(tpItemsForAnalysis: any[], analysisItem: any): string[] {
  if (!analysisItem) return ['Butir Analisis CP tidak tersedia'];
  const materialScope = analysisItem.materialScope || '';
  const cpCompetence = analysisItem.cpCompetence || '';
  const canonicalText = `${cpCompetence}; ${materialScope}`;

  // Split conservative chunks: ';', newline, '\n', and '\b(serta)\b'
  const chunks = canonicalText.split(/;|\n|\bserta\b/i).map(c => c.trim()).filter(Boolean);
  if (chunks.length === 0) return [];

  const unionText = tpItemsForAnalysis.map(i => [
    i.competence || i.competency || '',
    i.contentScope || '',
    i.statement || i.description || '',
  ].join(' ')).join(' ');

  const unionTokens = new Set(getSubstantiveTokens(unionText));

  const missing: string[] = [];
  for (const chunk of chunks) {
    const chunkTokens = getSubstantiveTokens(chunk);
    if (chunkTokens.length === 0) continue;

    const matched = chunkTokens.filter(t => unionTokens.has(t));
    if (chunkTokens.length <= 5) {
      if (matched.length < chunkTokens.length) {
        missing.push(chunk);
      }
    } else {
      const minOverlap = Math.max(2, Math.ceil(0.7 * chunkTokens.length));
      if (matched.length < minOverlap) {
        missing.push(chunk);
      }
    }
  }

  return missing;
}

export function checkTPSemanticFidelity(tpItems: any[], analysisItems: any[]): { isValid: boolean; issues: string[] } {
  const issues: string[] = [];
  const analysisMap = new Map(analysisItems.map(a => [String(a.id), a]));
  const tpMapByAnalysisId = new Map<string, any[]>();

  for (let i = 0; i < tpItems.length; i++) {
    const tpItem = tpItems[i];
    const analysisIds = (Array.isArray(tpItem.cpAnalysisItemIds) && tpItem.cpAnalysisItemIds.length > 0)
      ? tpItem.cpAnalysisItemIds
      : (tpItem.cpAnalysisId ? [tpItem.cpAnalysisId] : []);
    
    if (analysisIds.length === 1) {
      const anaId = String(analysisIds[0]);
      const analysisItem = analysisMap.get(anaId);
      if (analysisItem) {
        if (!tpMapByAnalysisId.has(anaId)) {
          tpMapByAnalysisId.set(anaId, []);
        }
        tpMapByAnalysisId.get(anaId)!.push(tpItem);

        // Check individual relevance
        const isRelevant = checkIndividualTPRelevance(tpItem, analysisItem);
        if (!isRelevant) {
          issues.push(`Butir TP ke-${i + 1} (${tpItem.code || 'Tanpa Kode'}) tidak memiliki relevansi semantis terhadap butir Analisis CP rujukan (${anaId}).`);
        }
      }
    }
  }

  // Check aggregate coverage per AnalysisItem
  for (const [anaId, analysisItem] of analysisMap.entries()) {
    const associatedTPs = tpMapByAnalysisId.get(anaId) || [];
    if (associatedTPs.length === 0) {
      issues.push(`Butir Analisis CP "${analysisItem.elementName || 'Elemen'}" (${anaId}) belum memiliki TP rujukan.`);
      continue;
    }
    const isCovered = checkAggregateTPCoverage(associatedTPs, analysisItem);
    if (!isCovered) {
      issues.push(`Butir Analisis CP "${analysisItem.elementName || 'Elemen'}" (${analysisItem.cpCompetence || anaId}) belum terwakili penuh secara semantis oleh TP rujukan. Bagian belum tercakup: ${getUncoveredTPChunks(associatedTPs, analysisItem).join('; ')}.`);
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
