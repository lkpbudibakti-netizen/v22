import { detectCompetenceGroups, hasCompatibleCompetence } from './atpSemanticFidelity';

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
        missing.push(`${chunk} [sinyal terwakili: ${matched.join(', ') || 'belum ditemukan'}; perlu ditinjau: ${chunkTokens.filter(t => !unionTokens.has(t)).join(', ')}]`);
      }
    } else {
      const minOverlap = Math.max(2, Math.ceil(0.7 * chunkTokens.length));
      if (matched.length < minOverlap) {
        missing.push(`${chunk} [sinyal terwakili: ${matched.join(', ') || 'belum ditemukan'}; perlu ditinjau: ${chunkTokens.filter(t => !unionTokens.has(t)).join(', ')}]`);
      }
    }
  }

  return missing;
}

export function tpSubstanceFingerprint(tpItems: any[], analysisItem: any): string {
  return JSON.stringify({ analysis: [analysisItem.id, analysisItem.elementId, analysisItem.elementName, analysisItem.cpText, analysisItem.cpCompetence, analysisItem.materialScope],
    items: tpItems.map(i => [i.id, i.code, i.statement || i.description, i.competence || i.competency, i.contentScope,
      i.cpAnalysisItemIds || [i.cpAnalysisId]]) });
}

export function tpWordingIssues(tpItems: any[]): string[] {
  const seen = new Set<string>();
  return tpItems.flatMap((item, index) => {
    const text = String(item.statement || item.description || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const issues: string[] = [];
    if (/\b(\w{4,})\s+\1\b/i.test(text) || /(?:&\s*){2,}|\bdan\s+dan\b/i.test(text))
      issues.push(`TP ${item.code || index + 1}: rumusan mengulang kata/konjungsi; revisi kalimat agar koheren.`);
    if (seen.has(text) && text) issues.push(`TP ${item.code || index + 1}: rumusan duplikat; tinjau tujuan spesifiknya.`);
    const demanded = detectCompetenceGroups(item.competence || item.competency);
    const expressed = detectCompetenceGroups(text);
    if (demanded.length && expressed.length && !hasCompatibleCompetence(new Set(expressed), demanded))
      issues.push(`TP ${item.code || index + 1}: kompetensi pada metadata tidak sesuai rumusan TP; revisi manual, bukan menambah kata untuk validator.`);
    seen.add(text);
    return issues;
  });
}

export function checkTPSemanticFidelity(tpItems: any[], analysisItems: any[], reviews: { analysisId: string; fingerprint: string; rationale: string }[] = []): { isValid: boolean; issues: string[] } {
  const issues: string[] = tpWordingIssues(tpItems);
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

        // Token overlap is a screening signal, never a semantic certificate.
        const isRelevant = checkIndividualTPRelevance(tpItem, analysisItem);
        const associated = tpItems.filter(item => (item.cpAnalysisItemIds || [item.cpAnalysisId]).includes(anaId));
        const reviewed = reviews.some(r => r.analysisId === anaId && r.fingerprint === tpSubstanceFingerprint(associated, analysisItem) && r.rationale.trim().length >= 30);
        if (!isRelevant && !reviewed) {
          issues.push(`TP ${tpItem.code || i + 1}: relevansi terhadap Analisis CP ${anaId} belum dapat dipastikan otomatis. Revisi manual atau berikan alasan substansi pada tinjauan guru.`);
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
    const demanded = detectCompetenceGroups(analysisItem.cpCompetence);
    const expressed = new Set(associatedTPs.flatMap(item => detectCompetenceGroups(item.statement || item.description || '')));
    const missingCompetences = demanded.filter(group => !hasCompatibleCompetence(expressed, [group]));
    // A teacher explanation can resolve a paraphrase, not override an explicit
    // competence conflict (e.g. knowing a movement instead of practising it).
    if (expressed.size && missingCompetences.length) {
      const labels: Record<string, string> = { understand: 'pemahaman', apply: 'penerapan', analyze: 'analisis', practice: 'praktik', create: 'kreasi', evaluate: 'evaluasi', explore: 'eksplorasi', participate: 'partisipasi', observe: 'pengamatan' };
      issues.push(`Analisis CP ${anaId}: rumusan TP belum menunjukkan tuntutan kompetensi ${missingCompetences.map(group => labels[group] || group).join(', ')} (${analysisItem.cpCompetence}). Revisi TP secara manual; konfirmasi alasan tidak menggantikan tuntutan yang hilang.`);
      continue;
    }
    const isCovered = checkAggregateTPCoverage(associatedTPs, analysisItem);
    const reviewed = reviews.some(r => r.analysisId === anaId && r.fingerprint === tpSubstanceFingerprint(associatedTPs, analysisItem) && r.rationale.trim().length >= 30);
    if (!isCovered && !reviewed) {
      issues.push(`Analisis CP ${anaId} (${analysisItem.elementName || 'Elemen'}): pemeriksaan tekstual belum memastikan cakupan. Tinjau bagian: ${getUncoveredTPChunks(associatedTPs, analysisItem).join('; ')}. Ini memerlukan revisi atau alasan relevansi guru, bukan kewajiban regenerasi AI.`);
    }
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
