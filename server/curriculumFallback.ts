import { assignGeneratedTPCodes, canonicalScopeCode } from '../src/services/tpCodeContract';
import { checkAggregateTPCoverage } from '../src/services/tpSemanticFidelity';
/**
 * Pedagogical Rule-Based Engine & Fallback Generator for Kurikulum Merdeka
 * Used when GEMINI_API_KEY is not configured or when AI services are temporarily unreachable.
 */

export interface FallbackAnalyzeCPParams {
  cpText?: string;
  elements?: Array<{ id?: string; elementId?: string; name: string; content: string }>;
  subject?: string;
  grade?: string;
  phase?: string;
  curriculum?: string;
}

export function deriveScopeCode(scopeText?: string): string {
  if (!scopeText || !scopeText.trim()) return 'MAT';
  const words = scopeText.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const code = words.map((w) => w[0].toUpperCase()).slice(0, 4).join('');
    if (code.length >= 2) return code;
  }
  const word = words[0].toUpperCase();
  if (word.length <= 4) return word;
  return word.slice(0, 3);
}

export function fallbackAnalyzeCP(params: FallbackAnalyzeCPParams) {
  const subject = params.subject || 'Mata Pelajaran';
  const grade = params.grade || '';
  const phase = params.phase || '';
  const cpGeneralText = (params.cpText || '').trim();
  const rawElements = Array.isArray(params.elements) ? params.elements : [];

  const commonKKOList = [
    'Mempraktikkan',
    'Menerapkan',
    'Mengidentifikasi',
    'Mengenali',
    'Menaati',
    'Mengeksplorasi',
    'Menyimpulkan',
    'Berpartisipasi',
    'Memahami',
    'Menunjukkan',
    'Menjaga',
    'Menjelaskan',
    'Menganalisis',
    'Mengevaluasi',
    'Merancang',
    'Menyajikan',
    'Mengomunikasikan',
    'Menciptakan',
    'Membandingkan',
    'Mendeskripsikan',
    'Menyusun',
  ];

  const extractCompetenceFromText = (text: string): string => {
    if (!text) return '';
    const matched = commonKKOList.filter((kko) => new RegExp(`\\b${kko}\\b`, 'i').test(text));
    if (matched.length > 0) {
      return matched.join(' & ');
    }
    return ''; // Leave empty if uncertain!
  };

  const cleanScopeText = (text: string): string => {
    if (!text) return '';
    return text
      .replace(/^(pada akhir fase|peserta didik mampu|peserta didik|murid mampu|pada fase ini|peserta didik dapat)\s+/i, '')
      .trim();
  };

  const items: Array<{
    elementId?: string;
    elementName: string;
    scopeCode: string;
    cpText: string;
    cpCompetence: string;
    materialScope: string;
    meaningfulUnderstanding: string;
    suggestedTp: string;
  }> = [];

  const splitIntoAtomicSegments = (content: string): string[] => {
    if (!content || !content.trim()) return [];
    // Split by semicolons first if present, otherwise by periods followed by space/capital
    const rawParts = content
      .split(/;\s*|\.\s+(?=[A-Z])/)
      .map((p) => p.replace(/\.$/, '').trim())
      .filter((p) => p.length > 0);

    return rawParts.length > 0 ? rawParts : [content.trim()];
  };

  if (rawElements.length > 0) {
    rawElements.forEach((elem, idx) => {
      const elemName = elem.name?.trim() || `Elemen ${idx + 1}`;
      const elemContent = elem.content?.trim() || '';
      const elemId = (elem.id && elem.id.trim()) || (elem.elementId && elem.elementId.trim()) || undefined;

      const segments = splitIntoAtomicSegments(elemContent);
      if (segments.length === 0) {
        segments.push(elemContent);
      }

      segments.forEach((seg) => {
        const competence = extractCompetenceFromText(seg) || extractCompetenceFromText(elemContent);
        const scope = cleanScopeText(seg) || cleanScopeText(elemContent);
        const scopeCode = deriveScopeCode(scope || elemName);
        const suggestedTp = competence && scope ? `Peserta didik mampu ${competence.toLowerCase()} ${scope}.` : '';

        items.push({
          elementId: elemId,
          elementName: elemName,
          scopeCode,
          cpText: elemContent,
          cpCompetence: competence,
          materialScope: scope,
          meaningfulUnderstanding: '',
          suggestedTp,
        });
      });
    });
  } else if (cpGeneralText) {
    const competence = extractCompetenceFromText(cpGeneralText);
    const scope = cleanScopeText(cpGeneralText);
    const scopeCode = deriveScopeCode(scope || 'Umum');
    const suggestedTp = competence && scope ? `Peserta didik mampu ${competence.toLowerCase()} ${scope}.` : '';

    items.push({
      elementId: undefined,
      elementName: 'Capaian Umum',
      scopeCode,
      cpText: cpGeneralText,
      cpCompetence: competence,
      materialScope: scope,
      meaningfulUnderstanding: '',
      suggestedTp,
    });
  }

  const generalSummary = cpGeneralText || (items.length > 0 ? items.map((i) => `${i.elementName}: ${i.cpText}`).join('; ') : `Analisis Capaian Pembelajaran ${subject} ${grade} (${phase}).`);

  return {
    generalSummary,
    items,
  };
}

export interface FallbackGenerateTPParams {
  cpGeneral?: string;
  cpElements?: { code?: string; name: string; content: string }[];
  cpAnalysisItems?: Array<{
    id: string;
    elementId?: string;
    elementName?: string;
    scopeCode?: string;
    cpCompetence?: string;
    materialScope?: string;
    suggestedTp?: string;
  }>;
  existingTps?: Array<{
    id: string;
    code?: string;
    scopeCode?: string;
    elementName?: string;
    statement: string;
    competence?: string;
    contentScope?: string;
    p3Dimensions?: string[];
    cpAnalysisItemIds?: string[];
    order?: number;
  }>;
  subject?: string;
  grade?: string;
  phase?: string;
  curriculum?: string;
  count?: number;
}

/**
 * Helper to split a clear comma-separated enumeration list.
 * Conservative: avoids splitting explanatory phrases like ", yaitu" or plain sentences.
 */
function splitCommaList(text: string): string[] | null {
  if (!text || !text.includes(',')) {
    return null;
  }

  // Safety check: Don't split if comma is followed by explanatory appositions
  if (/,\s*(?:yaitu|yakni|seperti|contohnya|misalnya)\b/i.test(text)) {
    return null;
  }

  let normalized = text.trim();

  // Normalize trailing conjunction in comma series:
  // e.g. "A, B, dan C" -> "A, B, C"
  // e.g. "A, B dan C"  -> "A, B, C"
  const trailingConjunctionRegex = /,\s*(?:dan|serta|atau)\s+/i;
  const noCommaConjunctionRegex = /\s+(?:dan|serta|atau)\s+/i;

  if (trailingConjunctionRegex.test(normalized)) {
    normalized = normalized.replace(trailingConjunctionRegex, ', ');
  } else if (noCommaConjunctionRegex.test(normalized)) {
    // Only replace " dan " if there was already a comma earlier in the string
    const lastDanIdx = normalized.search(noCommaConjunctionRegex);
    const firstCommaIdx = normalized.indexOf(',');
    if (firstCommaIdx !== -1 && firstCommaIdx < lastDanIdx) {
      normalized = normalized.slice(0, lastDanIdx) + ', ' + normalized.slice(lastDanIdx).replace(noCommaConjunctionRegex, '');
    }
  }

  const rawParts = normalized
    .split(/,\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  if (rawParts.length < 2) {
    return null;
  }

  // If any part is an excessively long clause (> 80 chars), it's likely a sentence pause rather than a topic list
  if (rawParts.some((p) => p.length > 80)) {
    return null;
  }

  return rawParts;
}

/**
 * Distribute shared contextual modifier (tail or prefix) across coordinated list items.
 * Example: ["Penjumlahan", "pengurangan", "perkalian", "pembagian pecahan"]
 * -> ["Penjumlahan pecahan", "Pengurangan pecahan", "Perkalian pecahan", "Pembagian pecahan"]
 * Example: ["Lokomotor", "Non-Lokomotor", "Manipulatif"]
 * -> ["Lokomotor", "Non-Lokomotor", "Manipulatif"]
 */
function distributeSharedContext(rawParts: string[]): string[] {
  if (rawParts.length < 2) return rawParts;

  let parts = rawParts.map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length < 2) return parts;

  // 1. Check for shared trailing modifier/context
  const lastPart = parts[parts.length - 1];
  const lastWords = lastPart.split(/\s+/);
  const precedingParts = parts.slice(0, parts.length - 1);
  const precedingLengths = precedingParts.map((p) => p.split(/\s+/).length);
  const minPrecedingLen = Math.min(...precedingLengths);
  const maxPrecedingLen = Math.max(...precedingLengths);

  // If earlier parts have similar length (e.g. 1-2 words), and last part has strictly more words:
  if (minPrecedingLen >= 1 && maxPrecedingLen <= minPrecedingLen + 1 && lastWords.length > maxPrecedingLen) {
    const headWordCount = maxPrecedingLen;
    const candidateTail = lastWords.slice(headWordCount).join(' ');

    const noneHaveTail = precedingParts.every(
      (p) => !p.toLowerCase().endsWith(candidateTail.toLowerCase())
    );

    if (noneHaveTail && candidateTail.length > 1) {
      parts = parts.map((p, idx) => {
        if (idx === parts.length - 1) return p;
        return `${p} ${candidateTail}`;
      });
    }
  }

  // 2. Check for shared leading prefix
  const firstPart = parts[0];
  const firstWords = firstPart.split(/\s+/);
  const subsequentParts = parts.slice(1);
  const subsequentLengths = subsequentParts.map((p) => p.split(/\s+/).length);
  const minSubsequentLen = Math.min(...subsequentLengths);
  const maxSubsequentLen = Math.max(...subsequentLengths);

  if (minSubsequentLen >= 1 && maxSubsequentLen <= minSubsequentLen + 1 && firstWords.length > maxSubsequentLen) {
    const prefixWordCount = firstWords.length - maxSubsequentLen;
    const candidatePrefix = firstWords.slice(0, prefixWordCount).join(' ');

    const noneHavePrefix = subsequentParts.every(
      (p) => !p.toLowerCase().startsWith(candidatePrefix.toLowerCase())
    );

    if (noneHavePrefix && candidatePrefix.length > 1) {
      parts = parts.map((p, idx) => {
        if (idx === 0) return p;
        return `${candidatePrefix} ${p}`;
      });
    }
  }

  // Capitalize first letter of each part cleanly
  return parts.map((p) => {
    const trimmed = p.trim();
    if (!trimmed) return trimmed;
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  });
}

/**
 * Subject-agnostic, conservative helper to decompose a compound material scope into atomic units.
 */
function decomposeCompoundScope(scope: string): string[] {
  if (!scope || typeof scope !== 'string') return [];
  const trimmed = scope.trim();
  if (trimmed.length < 3) return [trimmed];

  // 1. Strip generic metadata prefixes if present (e.g. "Lingkup Materi:", "Materi:", "Topik:")
  const cleanScope = trimmed.replace(/^(?:lingkup\s+materi|materi\s+pokok|materi|topik)\s*:\s*/i, '').trim();

  // 2. Check for explicit semicolons ';'
  if (cleanScope.includes(';')) {
    const parts = cleanScope
      .split(/;+/)
      .map((p) => p.replace(/^\s*(?:\d+[\.\)]|[-*•]|\([0-9a-zA-Z]+\))\s*/, '').trim())
      .filter((p) => p.length > 1);
    if (parts.length > 1) {
      return distributeSharedContext(parts);
    }
  }

  // 3. Check for explicit newlines
  if (cleanScope.includes('\n')) {
    const parts = cleanScope
      .split(/[\r\n]+/)
      .map((p) => p.replace(/^\s*(?:\d+[\.\)]|[-*•]|\([0-9a-zA-Z]+\))\s*/, '').trim())
      .filter((p) => p.length > 1);
    if (parts.length > 1) {
      return distributeSharedContext(parts);
    }
  }

  // 4. Check for explicit inline enumeration patterns like:
  // "1. ... 2. ... 3. ..." or "(1) ... (2) ... (3) ..." or "a) ... b) ... c) ..."
  const enumRegex = /(?:^|\s)(?:\d+[\.\)]|\([0-9a-zA-Z]\)|[a-zA-Z]\))\s+/;
  if (enumRegex.test(cleanScope)) {
    const parts = cleanScope
      .split(enumRegex)
      .map((p) => p.trim())
      .filter((p) => p.length > 1);
    if (parts.length > 1) {
      return distributeSharedContext(parts);
    }
  }

  // 5. Check for clear comma-separated list
  const commaParts = splitCommaList(cleanScope);
  if (commaParts && commaParts.length > 1) {
    return distributeSharedContext(commaParts);
  }

  // Conservative fallback: maintain single atomic scope
  return [cleanScope];
}

function resolveAtomicTPStatementAndCompetence(
  rawComp: string,
  rawScope: string,
  suggestedTp?: string
): { statement: string; competence: string; contentScope: string } {
  const contentScope = rawScope.trim();
  let statement = '';

  if (suggestedTp && suggestedTp.trim().length > 15 && checkAggregateTPCoverage([{ statement: suggestedTp }], { cpCompetence: rawComp, materialScope: rawScope })) {
    statement = suggestedTp.trim();
  } else {
    let cleanScope = contentScope;
    const compFirstWord = rawComp.trim().split(/\s+/)[0]?.toLowerCase() || '';
    if (compFirstWord.length > 3 && cleanScope.toLowerCase().startsWith(compFirstWord)) {
      cleanScope = cleanScope.slice(compFirstWord.length).trim();
    }
    statement = `Peserta didik mampu ${rawComp.toLowerCase()} ${cleanScope} secara mandiri dan bernalar kritis.`;
  }

  // Remove duplicate adjacent words (e.g. "menerapkan menerapkan")
  statement = statement.replace(/\b([a-zA-Z]+)\s+\1\b/gi, '$1').replace(/\s+/g, ' ').trim();

  // Determine actual competence demanded by this specific statement
  const commonKKOList = [
    'Mempraktikkan', 'Menerapkan', 'Mengidentifikasi', 'Mengenali', 'Menaati',
    'Mengeksplorasi', 'Menyimpulkan', 'Berpartisipasi', 'Memahami', 'Menunjukkan',
    'Menjaga', 'Menjelaskan', 'Menganalisis', 'Mengevaluasi', 'Merancang',
    'Menyajikan', 'Mengomunikasikan', 'Menciptakan', 'Membandingkan', 'Mendeskripsikan',
    'Menyusun', 'Mempertunjukkan'
  ];

  const matchedInStatement = commonKKOList.filter((kko) =>
    new RegExp(`\\b${kko}\\b`, 'i').test(statement)
  );

  let competence = rawComp;
  if (matchedInStatement.length > 0) {
    const rawParts = rawComp.split(/[\s&,;+]+dan\s+|[\s&,;+]+/).map((s) => s.trim()).filter((s) => s.length > 2);
    const intersected = rawParts.filter((rp) =>
      matchedInStatement.some((mis) => mis.toLowerCase() === rp.toLowerCase())
    );
    if (intersected.length > 0 && intersected.length < rawParts.length) {
      competence = intersected.join(' & ');
    } else if (intersected.length === 0) {
      competence = matchedInStatement.slice(0, 2).join(' & ');
    }
  }

  return { statement, competence, contentScope };
}

export function fallbackGenerateTP(params: FallbackGenerateTPParams) {
  const cpGeneralText = (params.cpGeneral || '').trim();
  const validElements = (params.cpElements || []).filter((e) => e && e.content && e.content.trim().length > 0);
  const cpAnalysisItems = Array.isArray(params.cpAnalysisItems) ? params.cpAnalysisItems : [];
  const existingTps = Array.isArray(params.existingTps) ? params.existingTps : [];

  // INSUFFICIENT CANONICAL SOURCE -> FAIL/BLOCK (return empty)
  if (!cpGeneralText && validElements.length === 0 && cpAnalysisItems.length === 0) {
    return existingTps;
  }

  const sequenceCounters = new Map<string, number>();

  const getSemanticCode = (elemName: string, scopeText: string, providedElemCode?: string, providedScopeCode?: string): { code: string; scopeCode: string } => {
    let elemCode = providedElemCode;
    if (!elemCode) {
      const foundIdx = validElements.findIndex((e) => e.name && elemName && e.name.toLowerCase().trim() === elemName.toLowerCase().trim());
      elemCode = foundIdx !== -1 ? (validElements[foundIdx].code || `E${foundIdx + 1}`) : 'E1';
    }
    const scopeCode = canonicalScopeCode(providedScopeCode, scopeText);
    const key = `${elemCode}-${scopeCode}`;
    const seq = (sequenceCounters.get(key) || 0) + 1;
    sequenceCounters.set(key, seq);
    return {
      code: `${elemCode}-${scopeCode}-${String(seq).padStart(2, '0')}`,
      scopeCode,
    };
  };

  const rawGeneratedItems: Array<{
    code: string;
    scopeCode: string;
    elementName: string;
    statement: string;
    competence: string;
    contentScope: string;
    p3Dimensions: string[];
    graduateProfileDimensions?: string[];
    cpAnalysisItemIds: string[];
  }> = [];

  if (cpAnalysisItems.length > 0) {
    // ATOMIC TP PROCESSING (Process each CPAnalysisItem independently - No merging across analysis items)
    for (let i = 0; i < cpAnalysisItems.length; i++) {
      const cpa = cpAnalysisItems[i];
      const elemName = (cpa.elementName || '').trim();
      const comp = cpa.cpCompetence?.trim() || 'Memahami & Menerapkan';
      const scope = (cpa.materialScope || '').trim();
      const analysisId = String(cpa.id);

      // Check for decomposition using robust, subject-agnostic helper
      const compoundParts = decomposeCompoundScope(scope);

      if (compoundParts.length > 1) {
        // Decompose into focused atomic TPs, each referencing this single CPAnalysisItem
        compoundParts.forEach((part) => {
          const { statement, competence, contentScope } = resolveAtomicTPStatementAndCompetence(comp, part);
          const { code, scopeCode } = getSemanticCode(elemName, contentScope, undefined, cpa.scopeCode);
          rawGeneratedItems.push({
            code,
            scopeCode,
            elementName: elemName,
            statement,
            competence,
            contentScope,
            p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
            graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
            cpAnalysisItemIds: [analysisId],
          });
        });
      } else {
        // Check if competence has explicit independent components via ; or \n
        const compParts = comp.includes(';') || comp.includes('\n')
          ? comp.split(/[;\n]+/).map((c) => c.trim()).filter((c) => c.length > 2)
          : [comp];

        if (compParts.length > 1) {
          const finalScope = compoundParts[0] || scope || 'Materi Pokok';
          compParts.forEach((cPart) => {
            const { statement, competence, contentScope } = resolveAtomicTPStatementAndCompetence(cPart, finalScope);
            const { code, scopeCode } = getSemanticCode(elemName, contentScope, undefined, cpa.scopeCode);
            rawGeneratedItems.push({
              code,
              scopeCode,
              elementName: elemName,
              statement,
              competence,
              contentScope,
              p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
              graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
              cpAnalysisItemIds: [analysisId],
            });
          });
        } else {
          // Single atomic TP
          const finalScope = compoundParts[0] || scope || 'Materi Pokok';
          const { statement, competence, contentScope } = resolveAtomicTPStatementAndCompetence(comp, finalScope, cpa.suggestedTp);
          const { code, scopeCode } = getSemanticCode(elemName, contentScope, undefined, cpa.scopeCode);
          rawGeneratedItems.push({
            code,
            scopeCode,
            elementName: elemName,
            statement,
            competence,
            contentScope,
            p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
            graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
            cpAnalysisItemIds: [analysisId],
          });
        }
      }
    }
  } else if (validElements.length > 0) {
    validElements.forEach((elem) => {
      const elemName = elem.name ? elem.name.trim() : '';
      const cleanContent = elem.content ? elem.content.slice(0, 100).trim() : '';
      if (!cleanContent) return;

      const { code, scopeCode } = getSemanticCode(elemName, cleanContent, elem.code);
      rawGeneratedItems.push({
        code,
        scopeCode,
        elementName: elemName,
        statement: `Peserta didik mampu memahami dan menerapkan konsep ${elemName ? elemName.toLowerCase() + ' terkait ' : ''}${cleanContent} secara mandiri dan bernalar kritis.`,
        competence: 'Memahami & Menerapkan',
        contentScope: cleanContent,
        p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
        graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
        cpAnalysisItemIds: [],
      });
    });
  } else if (cpGeneralText) {
    const scope = cpGeneralText.slice(0, 80).trim();
    const { code, scopeCode } = getSemanticCode('Capaian Umum', scope, 'E1');
    rawGeneratedItems.push({
      code,
      scopeCode,
      elementName: '',
      statement: `Peserta didik mampu memahami dan menjelaskan capaian ${cpGeneralText.slice(0, 100).trim()} secara komprehensif.`,
      competence: 'Memahami & Menjelaskan',
      contentScope: scope,
      p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
      graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
      cpAnalysisItemIds: [],
    });
  }

  const codedItems = assignGeneratedTPCodes(rawGeneratedItems, cpAnalysisItems, validElements);
  rawGeneratedItems.splice(0, rawGeneratedItems.length, ...codedItems);
  // Safe merge with existingTps if provided
  if (existingTps.length > 0) {
    const matchedExistingIds = new Set<string>();
    const merged: Array<any> = [];

    for (let i = 0; i < rawGeneratedItems.length; i++) {
      const gen = rawGeneratedItems[i];
      let bestMatch: any = null;
      let highestScore = 3;

      for (const exist of existingTps) {
        if (matchedExistingIds.has(exist.id)) continue;
        let score = 0;

        // cpAnalysisItemIds overlap
        const genIds = gen.cpAnalysisItemIds || [];
        const existIds = exist.cpAnalysisItemIds || [];
        if (genIds.length > 0 && existIds.length > 0 && genIds.some((id) => existIds.includes(id))) {
          score += 10;
        }

        // Element name match
        if (gen.elementName && exist.elementName && gen.elementName.toLowerCase() === exist.elementName.toLowerCase()) {
          score += 4;
        }

        // Content scope match
        if (gen.contentScope && exist.contentScope && (gen.contentScope.toLowerCase().includes(exist.contentScope.toLowerCase()) || exist.contentScope.toLowerCase().includes(gen.contentScope.toLowerCase()))) {
          score += 5;
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = exist;
        }
      }

      if (bestMatch) {
        matchedExistingIds.add(bestMatch.id);
        merged.push({
          ...bestMatch,
          id: bestMatch.id, // Mandatory stable ID!
          statement: bestMatch.statement || gen.statement,
          competence: bestMatch.competence || gen.competence,
          contentScope: bestMatch.contentScope || gen.contentScope,
          elementName: bestMatch.elementName || gen.elementName,
          p3Dimensions: bestMatch.p3Dimensions && bestMatch.p3Dimensions.length > 0 ? bestMatch.p3Dimensions : gen.p3Dimensions,
          cpAnalysisItemIds: gen.cpAnalysisItemIds,
        });
      } else {
        merged.push({
          ...gen,
          id: `tp-item-${Date.now()}-${i + 1}`,
        });
      }
    }

    // Preserve existing unmatched TPs
    existingTps.forEach((exist) => {
      if (!matchedExistingIds.has(exist.id)) {
        merged.push(exist);
      }
    });

    return merged.map((it, idx) => ({ ...it, order: idx + 1 }));
  }

  return rawGeneratedItems;
}

export interface FallbackGenerateATPParams {
  tps: Array<{
    id?: string;
    code: string;
    statement: string;
    elementName?: string;
    competence?: string;
    contentScope?: string;
    p3Dimensions?: string[];
  }>;
  cpGeneral?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  semester?: string;
  academicYear?: string;
  totalHoursPerWeek?: number;
}

export function fallbackGenerateATP(params: FallbackGenerateATPParams) {
  const subject = params.subject || '';
  const grade = params.grade || '';
  const phase = params.phase || '';
  const tps = params.tps || [];

  if (tps.length === 0) {
    return {
      rationale: subject && grade
        ? `Alur Tujuan Pembelajaran (ATP) untuk ${subject} ${grade} (${phase}).`
        : 'Alur Tujuan Pembelajaran (ATP).',
      items: [],
    };
  }

  // Conservative semantic grouping
  const getScopeCode = (tp: (typeof tps)[0]): string => {
    if ((tp as any).scopeCode && typeof (tp as any).scopeCode === 'string') {
      return (tp as any).scopeCode.trim().toUpperCase();
    }
    if (tp.code && typeof tp.code === 'string') {
      const parts = tp.code.trim().split('-');
      if (parts.length >= 3) {
        return parts[1].trim().toUpperCase();
      }
    }
    return '';
  };

  const isSpecificScopeCode = (sc: string): boolean => {
    return Boolean(sc && sc !== '' && sc !== 'MAT' && sc !== 'GEN');
  };

  const normalizeScopeText = (text: string): string => {
    return text
      .toLowerCase()
      .replace(/\bnon[\s-]+lokomotor\b/g, 'nonlokomotor')
      .replace(/\bnon[\s-]+/g, 'non');
  };

  const GENERIC_CURRICULUM_WORDS = new Set([
    // Function words & prepositions
    'dan', 'atau', 'pada', 'dalam', 'dengan', 'untuk', 'secara', 'yang', 'serta',
    'ke', 'di', 'dari', 'sebagai', 'oleh', 'tentang', 'terkait', 'antara', 'melalui',
    'tanpa', 'hingga', 'sampai', 'maupun',
    // Pedagogical process & cognitive qualifiers
    'konsep', 'pemahaman', 'penerapan', 'aktivitas', 'keterampilan', 'materi', 'pokok', 'dasar',
    'pola', 'variasi', 'praktik', 'analisis', 'identifikasi', 'kemampuan', 'kompetensi', 'proses',
    'tujuan', 'pengenalan', 'pembelajaran', 'kegiatan', 'latihan', 'tahap', 'metode', 'cara',
    'aturan', 'kaidah', 'contoh', 'hasil', 'bagian', 'prinsip', 'makna', 'evaluasi', 'eksplorasi',
    'pengembangan', 'penguasaan', 'tingkat', 'lingkup', 'kategori',
    // Broad umbrella discipline words (not specific topics on their own)
    'teks',
    'bilangan',
    'gerak',
    'operasi',
    'bentuk',
    'karya',
    'seni',
    'gambar',
    'alat',
    'unsur',
    'objek',
    'media',
    'lingkungan',
    'ruang',
  ]);

  const extractSpecificKeywords = (text?: string): string[] => {
    if (!text) return [];
    const normalized = normalizeScopeText(text).replace(/[^a-z0-9\s]/g, ' ');
    return normalized
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 2 && !GENERIC_CURRICULUM_WORDS.has(w));
  };

  const haveStrongSemanticRelation = (
    tpA: (typeof tps)[0],
    tpB: (typeof tps)[0]
  ): boolean => {
    if (!tpA || !tpB) return false;
    if (tpA.id && tpB.id && tpA.id === tpB.id) return true;

    const rawScopeA = (tpA.contentScope || '').trim();
    const rawScopeB = (tpB.contentScope || '').trim();
    if (!rawScopeA || !rawScopeB) return false;

    // 1. Normalized contentScope sama persis
    const cleanScopeA = normalizeScopeText(rawScopeA).replace(/\s+/g, ' ').trim();
    const cleanScopeB = normalizeScopeText(rawScopeB).replace(/\s+/g, ' ').trim();
    if (cleanScopeA === cleanScopeB) {
      return true;
    }

    // Extract specific non-generic topic keywords
    const kwA = extractSpecificKeywords(rawScopeA);
    const kwB = extractSpecificKeywords(rawScopeB);
    if (kwA.length === 0 || kwB.length === 0) {
      return false;
    }

    const sharedKeywords = kwA.filter((w) => kwB.includes(w));
    if (sharedKeywords.length === 0) {
      return false;
    }

    // 2. scopeCode sama + specific topic overlap yang jelas
    const scA = getScopeCode(tpA);
    const scB = getScopeCode(tpB);
    const isSameSpecificScopeCode = isSpecificScopeCode(scA) && isSpecificScopeCode(scB) && scA === scB;
    if (isSameSpecificScopeCode && sharedKeywords.length >= 1) {
      return true;
    }

    // 3. contentScope memiliki semantic overlap kuat (lintas elemen atau lintas scopeCode)
    if (sharedKeywords.length >= 1) {
      return true;
    }

    // Conservative: if not clearly the same specific topic, do NOT group
    return false;
  };

  const visited = new Set<number>();
  const clusters: Array<Array<(typeof tps)[0]>> = [];

  for (let i = 0; i < tps.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    const currentGroup = [tps[i]];

    for (let j = i + 1; j < tps.length; j++) {
      if (visited.has(j)) continue;
      if (haveStrongSemanticRelation(tps[i], tps[j])) {
        visited.add(j);
        currentGroup.push(tps[j]);
      }
    }

    clusters.push(currentGroup);
  }

  // Canonical ATP items: ONLY stepNumber, linkedTpIds, focus
  const items = clusters.map((group, idx) => {
    const stepNumber = idx + 1;
    const linkedTpIds = group.map((t) => t.id || '').filter(Boolean);
    const primary = group[0];
    const scopes = Array.from(new Set(group.map((t) => t.contentScope).filter(Boolean)));
    const focus = group.length === 1
      ? (primary.contentScope ? `Penguasaan ${primary.contentScope}` : primary.statement)
      : (scopes.length > 0 ? `Penguasaan dan Penerapan ${scopes.join(' dan ')}` : primary.statement);

    return {
      stepNumber,
      linkedTpIds,
      focus,
    };
  });

  return {
    rationale: subject && grade
      ? `Alur Tujuan Pembelajaran (ATP) untuk ${subject} ${grade} (${phase}).`
      : 'Alur Tujuan Pembelajaran (ATP).',
    items,
  };
}

export function fallbackRefineText(text: string, instruction?: string, context?: string) {
  if (!text) return '';
  const trimmed = text.trim();
  // Capitalize sentence start and trim multiple spaces
  const clean = trimmed
    .replace(/\s+/g, ' ')
    .replace(/(^\w|\.\s+\w)/gm, (match) => match.toUpperCase());
  return clean;
}

export interface FallbackGenerateLearningPlanParams {
  academicSetting?: {
    subject?: string;
    grade?: string;
    phase?: string;
    curriculum?: string;
    academicYear?: string;
    semester?: string;
  };
  tps?: Array<{
    id?: string;
    code?: string;
    statement?: string;
    contentScope?: string;
    competence?: string;
  }>;
  atpItems?: Array<{
    id?: string;
    stepNumber?: number;
    materialScope?: string;
    jp?: number;
  }>;
  topic?: string;
}

export function fallbackGenerateLearningPlan(params: FallbackGenerateLearningPlanParams) {
  const subject = params.academicSetting?.subject || '';
  const grade = params.academicSetting?.grade || '';
  const tps = params.tps || [];
  const primaryTp = tps[0];
  const topicName = params.topic || primaryTp?.contentScope || primaryTp?.statement || `Topik Pembelajaran ${subject}`.trim();
  const tpCodeStr = primaryTp?.code ? `[${primaryTp.code}] ` : '';
  const linkedTpIds = tps.map((t) => t.id).filter(Boolean) as string[];

  return {
    title: `Draf Modul Ajar: ${topicName}`,
    topic: topicName,
    meaningfulUnderstanding: `Murid memahami konsep esensial ${topicName} dan mampu menerapkannya secara mandiri serta kritis dalam konteks kehidupan sehari-hari.`,
    triggerQuestions: [
      `Mengapa pemahaman tentang ${topicName} penting dalam kehidupan sehari-hari?`,
      `Bagaimana kita dapat menerapkan konsep ini untuk menyelesaikan permasalahan di lingkungan sekitar?`
    ],
    learningExperiences: [
      {
        id: `exp-1-${Date.now()}`,
        phase: 'UNDERSTAND',
        description: `Murid mengamati contoh kontekstual, mendiskusikan konsep dasar ${topicName}, dan mengidentifikasi bagian-bagian utamanya.`,
        durationMinutes: 35,
        linkedTpIds
      },
      {
        id: `exp-2-${Date.now()}`,
        phase: 'APPLY',
        description: `Murid secara berpasangan/kelompok melakukan eksplorasi dan menyelesaikan latihan penerapan ${topicName}.`,
        durationMinutes: 45,
        linkedTpIds
      },
      {
        id: `exp-3-${Date.now()}`,
        phase: 'REFLECT',
        description: `Murid menyimpulkan pemahaman, melakukan refleksi diri tentang tantangan belajar, dan merencanakan langkah perbaikan.`,
        durationMinutes: 20,
        linkedTpIds
      }
    ],
    deepLearningContext: {
      principles: ['MINDFUL', 'MEANINGFUL', 'JOYFUL'],
      graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri']
    },
    graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
    learningSteps: {
      opening: [
        {
          id: `step-open-${Date.now()}`,
          stepName: 'Kegiatan Awal / Apersepsi',
          description: `Guru menyapa murid, memeriksa presensi, menyampaikan tujuan pembelajaran ${tpCodeStr}${topicName}, serta memberikan pertanyaan pemantik.`,
          durationMinutes: 10
        }
      ],
      core: [
        {
          id: `step-core-${Date.now()}`,
          stepName: 'Kegiatan Inti (Eksplorasi & Aplikasi)',
          description: `Murid terlibat aktif dalam aktivitas berkesadaran dan pemecahan masalah ${topicName} secara terbimbing dan mandiri.`,
          durationMinutes: 70
        }
      ],
      closing: [
        {
          id: `step-close-${Date.now()}`,
          stepName: 'Kegiatan Penutup & Refleksi',
          description: `Guru dan murid merangkum poin penting pembelajaran, melakukan refleksi, dan menyampaikan tindak lanjut untuk pertemuan berikutnya.`,
          durationMinutes: 10
        }
      ]
    },
    assessmentPlan: {
      initial: [
        {
          id: `asm-init-${Date.now()}`,
          type: 'INITIAL',
          technique: 'Tanya Jawab / Diagnostik Singkat',
          description: `Mengecek kesiapan dan pengetahuan awal murid mengenai ${topicName}.`,
          linkedTpIds
        }
      ],
      formative: [
        {
          id: `asm-form-${Date.now()}`,
          type: 'FORMATIVE',
          technique: 'Observasi Performa & Diskusi Kelompok',
          description: `Memantau keterlibatan, pemahaman konsep, dan sikap kolaboratif murid selama proses belajar.`,
          linkedTpIds
        }
      ],
      summative: [
        {
          id: `asm-sum-${Date.now()}`,
          type: 'SUMMATIVE',
          technique: 'Tes Subformatif / Unjuk Kerja',
          description: `Mengukur pencapaian Tujuan Pembelajaran ${tpCodeStr} pada akhir topik.`,
          linkedTpIds
        }
      ]
    },
    differentiation: {
      content: `Penyediaan materi visual/teks sesuai kesiapan belajar murid.`,
      process: `Bimbingan khusus bagi murid yang memerlukan pendampingan dan tantangan tambahan bagi yang cepat paham.`,
      product: `Murid diberikan pilihan bentuk penyajian hasil tugas (diagram, tulisan, atau presentasi lisan).`
    },
    reflection: {
      teacher: `Apakah seluruh murid mencapai target pembelajaran? Kendala apa yang dihadapi dan bagaimana solusinya?`,
      student: `Bagian mana dari pembelajaran ${topicName} yang paling menarik dan bagian mana yang masih memerlukan latihan?`
    },
    enrichmentPlan: `Pemberian soal tantangan kontekstual tingkat lanjut bagi murid dengan pencapaian di atas rata-rata.`,
    remedialPlan: `Bimbingan perorangan/kelompok kecil dan penyederhanaan latihan bagi murid yang belum tuntas.`,
    resources: [
      { id: `res-1-${Date.now()}`, title: `Buku Siswa ${subject} ${grade}`.trim() },
      { id: `res-2-${Date.now()}`, title: `Lembar Kerja Murid (LKM) ${topicName}` }
    ],
    allocatedJP: params.atpItems && params.atpItems.length > 0 ? params.atpItems.reduce((acc, curr) => acc + (curr.jp || 2), 0) : 2
  };
}

export interface FallbackATPMappingParams {
  atpItems: Array<{
    id: string;
    stepNumber?: number;
    tpCode?: string;
    tpStatement?: string;
    unitTitle?: string;
    materialScope?: string;
  }>;
  targetUnitCount: number;
  teacherUnits: Record<number, string>;
  subject?: string;
}

export function fallbackGenerateATPMapping(params: FallbackATPMappingParams) {
  const { atpItems, targetUnitCount, teacherUnits, subject = 'Mata Pelajaran' } = params;
  const count = Math.max(1, Math.min(20, targetUnitCount || 6));
  const totalItems = Math.max(1, atpItems.length);

  // Build units list
  const units: Array<{ unitIndex: number; unitTitle: string; description: string }> = [];
  for (let u = 1; u <= count; u++) {
    const existingTitle = teacherUnits[u];
    const unitTitle =
      existingTitle && existingTitle.trim().length > 0
        ? existingTitle.trim()
        : `Bab ${u}: Pembelajaran ${subject} Bagian ${u}`;
    units.push({
      unitIndex: u,
      unitTitle,
      description: `Materi pembelajaran unit ke-${u}`,
    });
  }

  // Distribute ATP items across units chronologically
  const mappings: Array<{ atpItemId: string; unitTitle: string; materialScope: string }> = [];

  atpItems.forEach((item, idx) => {
    // Calculate which unit this item falls into (balanced distribution)
    const unitIdx = Math.min(count, Math.floor((idx / totalItems) * count) + 1);
    const assignedUnit = units.find((u) => u.unitIndex === unitIdx) || units[0];

    const finalUnitTitle =
      item.unitTitle && item.unitTitle.trim().length > 0
        ? item.unitTitle.trim()
        : assignedUnit.unitTitle;

    let derivedMaterial =
      item.materialScope && item.materialScope.trim().length > 0
        ? item.materialScope.trim()
        : '';

    if (!derivedMaterial) {
      if (item.tpStatement) {
        // Extract meaningful topic from TP statement
        const cleanStmt = item.tpStatement.replace(/^(peserta didik|murid|siswa)\s+(dapat|mampu)\s+/i, '');
        derivedMaterial = cleanStmt.length > 60 ? `${cleanStmt.substring(0, 57)}...` : cleanStmt;
      } else {
        derivedMaterial = `Materi Pokok Langkah #${item.stepNumber || idx + 1}`;
      }
    }

    mappings.push({
      atpItemId: item.id,
      unitTitle: finalUnitTitle,
      materialScope: derivedMaterial,
    });
  });

  return {
    units,
    mappings,
  };
}

export function resolveCanonicalAtpTpIds(
  atp: any,
  validTpIds?: Set<string>
): string[] {
  if (!atp) return [];

  // A. Canonical linkedTpIds authority
  if (Array.isArray(atp.linkedTpIds) && atp.linkedTpIds.length > 0) {
    const canonicalIds = atp.linkedTpIds
      .map((id: any) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id: string) => id.length > 0 && (!validTpIds || validTpIds.has(id)));

    // Return unique valid canonical IDs (canonical wins)
    return Array.from(new Set(canonicalIds));
  }

  // B. Legacy fallback: only if linkedTpIds is absent / empty
  if (atp.tpId && typeof atp.tpId === 'string' && atp.tpId.trim().length > 0) {
    const legacyId = atp.tpId.trim();
    if (!validTpIds || validTpIds.has(legacyId)) {
      return [legacyId];
    }
  }

  return [];
}

export interface FallbackCanonicalUnitMappingParams {
  academicSettingId?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  tpData?: {
    id?: string;
    updatedAt?: string;
    items?: Array<{
      id: string;
      code?: string;
      scopeCode?: string;
      elementName?: string;
      statement: string;
      competence?: string;
      contentScope?: string;
      cpAnalysisId?: string;
      cpAnalysisItemIds?: string[];
      p3Dimensions?: string[];
      order?: number;
    }>;
  };
  atpData?: {
    id?: string;
    academicSettingId?: string;
    tpDataId?: string;
    updatedAt?: string;
    items?: Array<{
      id: string;
      stepNumber: number;
      linkedTpIds?: string[];
      focus?: string;
      // legacy only
      tpId?: string;
      tpCode?: string;
      tpStatement?: string;
      unitTitle?: string;
      materialScope?: string;
    }>;
  };
  cpAnalysisData?: {
    id?: string;
    items?: Array<{
      id: string;
      elementId?: string;
      elementName: string;
      scopeCode?: string;
      cpCompetence: string;
      materialScope: string;
      suggestedTp?: string;
    }>;
  };
  existingMapping?: {
    id?: string;
    academicSettingId?: string;
    atpId?: string;
    tpDataId?: string;
    units: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
      materials: Array<{
        id: string;
        title: string;
        order: number;
        linkedTpIds: string[];
        linkedAtpItemIds: string[];
      }>;
    }>;
  };
  targetUnitCount?: number;
  targetMaterialCountPerUnit?: number;
}

export function fallbackGenerateCanonicalATPUnitMapping(
  params: FallbackCanonicalUnitMappingParams
) {
  const {
    academicSettingId = '',
    subject = 'Mata Pelajaran',
    tpData,
    atpData,
    cpAnalysisData,
    existingMapping,
    targetUnitCount,
  } = params;

  const validTpItems = Array.isArray(tpData?.items) ? tpData.items : [];
  const validTpIdSet = new Set(validTpItems.map((tp) => tp.id));
  const tpMap = new Map<string, (typeof validTpItems)[0]>();
  validTpItems.forEach((tp) => tpMap.set(tp.id, tp));

  const validAtpItems = Array.isArray(atpData?.items)
    ? [...atpData.items].sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    : [];
  const atpMap = new Map<string, (typeof validAtpItems)[0]>();
  validAtpItems.forEach((atp) => atpMap.set(atp.id, atp));

  const getAtpTps = (atp: any): Array<(typeof validTpItems)[0]> => {
    const resolvedIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
    return resolvedIds.map((id) => tpMap.get(id)).filter(Boolean) as Array<(typeof validTpItems)[0]>;
  };

  const cpAnalysisItems = Array.isArray(cpAnalysisData?.items) ? cpAnalysisData.items : [];
  const cpaMap = new Map<string, (typeof cpAnalysisItems)[0]>();
  cpAnalysisItems.forEach((cpa) => cpaMap.set(cpa.id, cpa));

  // Indonesian stopwords for semantic keyword extraction
  const STOPWORDS = new Set([
    'dan', 'atau', 'pada', 'dalam', 'dengan', 'untuk', 'secara', 'yang', 'serta',
    'dapat', 'mampu', 'peserta', 'didik', 'siswa', 'murid', 'pembelajaran', 'materi',
    'konsep', 'memahami', 'mengidentifikasi', 'menjelaskan', 'mempraktikkan', 'menganalisis',
    'merancang', 'melakukan', 'tentang', 'terhadap', 'sebagai', 'melalui', 'proses',
    'tahap', 'bagian', 'berbagai', 'macam', 'jenis', 'dasar', 'awal', 'akhir', 'menggunakan'
  ]);

  const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    const clean = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const tokens = clean.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    return Array.from(new Set(tokens));
  };

  // Helper to extract clean content summary from TP
  const extractTopicFromTp = (tp?: (typeof validTpItems)[0]): string => {
    if (!tp) return 'Materi Pembelajaran';
    if (tp.contentScope && tp.contentScope.trim().length > 0) {
      return tp.contentScope.trim();
    }
    // Check linked CP analysis
    if (tp.cpAnalysisItemIds && tp.cpAnalysisItemIds.length > 0) {
      for (const cpaId of tp.cpAnalysisItemIds) {
        const cpa = cpaMap.get(cpaId);
        if (cpa && cpa.materialScope && cpa.materialScope.trim().length > 0) {
          return cpa.materialScope.trim();
        }
      }
    }
    const cleanStmt = (tp.statement || '')
      .replace(/^(peserta didik|murid|siswa)\s+(dapat|mampu)\s+/i, '')
      .trim();
    return cleanStmt.length > 60 ? `${cleanStmt.substring(0, 57)}...` : cleanStmt || 'Materi Pembelajaran';
  };

  const isCrossCuttingTp = (tp?: (typeof validTpItems)[0]): boolean => {
    if (!tp) return false;

    const checkSubstantiveCrossCutting = (text: string): boolean => {
      if (!text) return false;
      const clean = text.toLowerCase().trim();
      
      if (
        clean.includes('tanggung jawab') ||
        clean.includes('evaluasi diri') ||
        clean.includes('profil lulusan') ||
        clean.includes('profil pelajar pancasila') ||
        clean.includes('pengembangan karakter') ||
        clean.includes('gotong royong')
      ) {
        return true;
      }
      
      const strongKeywords = ['karakter', 'refleksi', 'kolaborasi', 'sikap', 'akhlak'];
      const words = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (words.some((w) => strongKeywords.includes(w))) {
        return true;
      }

      const ambiguousTokens = new Set(['nilai', 'sosial', 'moral', 'spiritual', 'emosional', 'kebinekaan']);
      const supportTokens = new Set([
        'nilai', 'sosial', 'moral', 'spiritual', 'emosional', 'kebinekaan', 
        'mandiri', 'kreatif', 'kritis', 'profil', 'diri', 'karakter', 'sikap', 'akhlak',
        'global', 'pancasila', 'lulusan', 'kolaborasi', 'refleksi', 'tanggung', 'jawab'
      ]);

      let hasAmbiguous = false;
      let supportCount = 0;
      
      words.forEach((w) => {
        if (ambiguousTokens.has(w)) hasAmbiguous = true;
        if (supportTokens.has(w)) supportCount++;
      });

      return hasAmbiguous && supportCount >= 2;
    };

    const checkStatementCrossCutting = (statement: string): boolean => {
      if (!statement) return false;
      const clean = statement.toLowerCase().trim();

      if (
        clean.includes('tanggung jawab') ||
        clean.includes('evaluasi diri') ||
        clean.includes('profil lulusan') ||
        clean.includes('profil pelajar pancasila') ||
        clean.includes('pengembangan karakter') ||
        clean.includes('gotong royong')
      ) {
        return true;
      }

      const strongKeywords = ['karakter', 'refleksi', 'kolaborasi', 'sikap', 'akhlak'];
      const words = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      return words.some((w) => strongKeywords.includes(w));
    };

    if (tp.contentScope && checkSubstantiveCrossCutting(tp.contentScope)) return true;
    if (tp.elementName && checkSubstantiveCrossCutting(tp.elementName)) return true;
    if (tp.statement && checkStatementCrossCutting(tp.statement)) return true;

    return false;
  };

  const areTpsSemanticallyRelated = (
    tpA?: (typeof validTpItems)[0],
    tpB?: (typeof validTpItems)[0]
  ): boolean => {
    if (!tpA || !tpB) return false;
    if (tpA.id === tpB.id) return true;

    // Direct contentScope match
    const scopeA = tpA.contentScope?.trim().toLowerCase();
    const scopeB = tpB.contentScope?.trim().toLowerCase();
    if (scopeA && scopeB && (scopeA === scopeB || scopeA.includes(scopeB) || scopeB.includes(scopeA))) {
      return true;
    }

    // scopeCode match
    const scA = tpA.scopeCode?.trim().toUpperCase();
    const scB = tpB.scopeCode?.trim().toUpperCase();
    if (scA && scB && scA === scB) {
      return true;
    }

    // Keyword overlap on scope or statement
    const kwA = extractKeywords(`${tpA.contentScope || ''} ${tpA.statement || ''}`);
    const kwB = extractKeywords(`${tpB.contentScope || ''} ${tpB.statement || ''}`);
    const overlap = kwA.filter((k) => kwB.includes(k));
    return overlap.length >= 1;
  };

  const areAtpItemsSemanticallyRelated = (atpA: any, atpB: any): boolean => {
    const tpsA = getAtpTps(atpA);
    const tpsB = getAtpTps(atpB);
    if (tpsA.length === 0 || tpsB.length === 0) {
      const kwA = extractKeywords(atpA.focus || '');
      const kwB = extractKeywords(atpB.focus || '');
      return kwA.some((k) => kwB.includes(k));
    }
    return tpsA.some((tA) => tpsB.some((tB) => areTpsSemanticallyRelated(tA, tB)));
  };

  // If existingMapping has units, strictly preserve teacher structure and matching
  if (existingMapping && Array.isArray(existingMapping.units) && existingMapping.units.length > 0) {
    const updatedUnits = existingMapping.units.map((unit, uIdx) => {
      const order = unit.order || uIdx + 1;
      const linkedAtpItemIds = (unit.linkedAtpItemIds || []).filter((id) => atpMap.has(id));

      const supportedTpIdSet = new Set<string>();
      linkedAtpItemIds.forEach((atpId) => {
        const atp = atpMap.get(atpId);
        if (atp) {
          const resolvedIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
          resolvedIds.forEach((tpId) => supportedTpIdSet.add(tpId));
        }
      });

      // Preserve explicit valid subset of TPs supported by unit ATPs (do NOT expand to all ATP TPs)
      const linkedTpIds = (unit.linkedTpIds || []).filter((id) => tpMap.has(id) && supportedTpIdSet.has(id));

      const linkedTps = linkedTpIds.map((id) => tpMap.get(id)).filter(Boolean) as Array<(typeof validTpItems)[0]>;

      let unitTitle = unit.title?.trim();
      if (!unitTitle) {
        const fallbackTopic = linkedTps.length > 0 ? extractTopicFromTp(linkedTps[0]) : `Bagian ${order}`;
        unitTitle = `Bab ${order}: ${fallbackTopic}`;
      }

      let materials = Array.isArray(unit.materials) ? [...unit.materials] : [];
      if (materials.length > 0) {
        materials = materials.map((mat, mIdx) => {
          const matOrder = mat.order || mIdx + 1;
          const matLinkedAtpItemIds = (mat.linkedAtpItemIds || []).filter((id) => atpMap.has(id) && linkedAtpItemIds.includes(id));

          const matSupportedTpSet = new Set<string>();
          matLinkedAtpItemIds.forEach((atpId) => {
            const atp = atpMap.get(atpId);
            if (atp) {
              const resolvedIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
              resolvedIds.forEach((tpId) => matSupportedTpSet.add(tpId));
            }
          });

          // Material TPs must be subset of unit.linkedTpIds AND supported by material's ATPs
          const matLinkedTpIds = (mat.linkedTpIds || []).filter(
            (id) => tpMap.has(id) && linkedTpIds.includes(id) && matSupportedTpSet.has(id)
          );

          let matTitle = mat.title?.trim();
          if (!matTitle) {
            const topic = matLinkedTpIds.length > 0 && tpMap.get(matLinkedTpIds[0])
              ? extractTopicFromTp(tpMap.get(matLinkedTpIds[0]))
              : (linkedTps[mIdx] ? extractTopicFromTp(linkedTps[mIdx]) : `Lingkup Materi ${matOrder}`);
            matTitle = topic;
          }

          return {
            id: mat.id || `mat-${Date.now()}-${uIdx + 1}-${matOrder}`,
            title: matTitle,
            order: matOrder,
            linkedTpIds: matLinkedTpIds,
            linkedAtpItemIds: matLinkedAtpItemIds,
          };
        });
      } else {
        const distinctScopes: string[] = [];
        linkedTps.forEach((tp) => {
          const t = extractTopicFromTp(tp);
          if (t && !distinctScopes.some((s) => s.toLowerCase() === t.toLowerCase())) {
            distinctScopes.push(t);
          }
        });

        if (distinctScopes.length > 0) {
          materials = distinctScopes.map((scopeTitle, mIdx) => {
            const supportingTps = linkedTps.filter((t) => extractTopicFromTp(t).toLowerCase() === scopeTitle.toLowerCase());
            const supportingTpIds = supportingTps.map((t) => t!.id);
            const matchingAtps = validAtpItems.filter((atp) =>
              resolveCanonicalAtpTpIds(atp, validTpIdSet).some((id) => supportingTpIds.includes(id)) &&
              linkedAtpItemIds.includes(atp.id)
            );
            return {
              id: `mat-${Date.now()}-${uIdx + 1}-${mIdx + 1}`,
              title: scopeTitle,
              order: mIdx + 1,
              linkedTpIds: supportingTpIds,
              linkedAtpItemIds: matchingAtps.map((a) => a.id),
            };
          });
        } else {
          materials = [
            {
              id: `mat-${Date.now()}-${uIdx + 1}-1`,
              title: unitTitle.replace(/^Bab\s+\d+:\s*/i, ''),
              order: 1,
              linkedTpIds: [],
              linkedAtpItemIds: [],
            },
          ];
        }
      }

      return {
        id: unit.id || `unit-${Date.now()}-${order}`,
        title: unitTitle,
        order,
        linkedTpIds,
        linkedAtpItemIds,
        materials,
      };
    });

    const resultMapping = {
      id: existingMapping.id || `aum-${Date.now()}`,
      academicSettingId: existingMapping.academicSettingId || academicSettingId,
      atpId: atpData?.id || '',
      tpDataId: tpData?.id || '',
      units: updatedUnits,
      basedOnTpUpdatedAt: tpData?.updatedAt,
      basedOnAtpUpdatedAt: atpData?.updatedAt,
      updatedAt: new Date().toISOString(),
    };
    return enforceCanonicalMappingInvariants(resultMapping, validTpItems, validAtpItems);
  }

  // Initial Generation: Deterministic Semantic Clustering along canonical ATP sequence
  const count = targetUnitCount ? Math.max(1, Math.min(20, targetUnitCount)) : undefined;

  // Split into cross-cutting and non-cross-cutting based on whole resolved TP set
  const nonCrossCuttingAtpItems = validAtpItems.filter((atp) => {
    const tps = getAtpTps(atp);
    return tps.length === 0 || !tps.every((tp) => isCrossCuttingTp(tp));
  });
  const crossCuttingAtpItems = validAtpItems.filter((atp) => {
    const tps = getAtpTps(atp);
    return tps.length > 0 && tps.every((tp) => isCrossCuttingTp(tp));
  });

  const rawClusters: Array<typeof validAtpItems> = [];
  let currentCluster: typeof validAtpItems = [];

  nonCrossCuttingAtpItems.forEach((atp) => {
    if (currentCluster.length === 0) {
      currentCluster.push(atp);
    } else {
      const isRelated = currentCluster.some((cAtp) => areAtpItemsSemanticallyRelated(atp, cAtp));
      if (isRelated) {
        currentCluster.push(atp);
      } else {
        rawClusters.push(currentCluster);
        currentCluster = [atp];
      }
    }
  });

  if (currentCluster.length > 0) {
    rawClusters.push(currentCluster);
  }

  let semanticClusters = rawClusters;
  if (semanticClusters.length === 0 && validAtpItems.length > 0) {
    semanticClusters = [[...validAtpItems]];
  }

  // Organic balancing against target count (only if count is specified)
  if (count) {
    while (semanticClusters.length > count && semanticClusters.length > 1) {
      let bestMergeIdx = 0;
      let highestSimilarity = -1;

      for (let i = 0; i < semanticClusters.length - 1; i++) {
        const c1 = semanticClusters[i];
        const c2 = semanticClusters[i + 1];
        const tp1 = c1.flatMap((a) => getAtpTps(a));
        const tp2 = c2.flatMap((a) => getAtpTps(a));

        let sim = 0;
        tp1.forEach((t1) => {
          tp2.forEach((t2) => {
            if (areTpsSemanticallyRelated(t1, t2)) sim += 2;
            const kw1 = extractKeywords(t1?.statement || '');
            const kw2 = extractKeywords(t2?.statement || '');
            sim += kw1.filter((k) => kw2.includes(k)).length;
          });
        });

        if (c1.length === 1 || c2.length === 1) sim += 1;

        if (sim > highestSimilarity) {
          highestSimilarity = sim;
          bestMergeIdx = i;
        }
      }

      const merged = [...semanticClusters[bestMergeIdx], ...semanticClusters[bestMergeIdx + 1]];
      semanticClusters.splice(bestMergeIdx, 2, merged);
    }
  }

  // Place cross-cutting ATP items into one or multiple relevant substantive clusters
  crossCuttingAtpItems.forEach((ccAtp) => {
    const ccTps = getAtpTps(ccAtp);

    // Calculate semantic and context similarity for each cluster
    const clusterScores = semanticClusters.map((cluster, cIdx) => {
      const clusterTps = cluster.flatMap((a) => getAtpTps(a));
      let sim = 0;
      ccTps.forEach((ccTp) => {
        clusterTps.forEach((cTp) => {
          if (areTpsSemanticallyRelated(ccTp, cTp)) sim += 3;
          const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
          const kwC = extractKeywords(`${cTp.contentScope || ''} ${cTp.statement || ''}`);
          sim += kwCC.filter((k) => kwC.includes(k)).length;
        });
      });

      // Tie breaker based on chronological step number proximity
      const avgStep = cluster.reduce((sum, a) => sum + (a.stepNumber || 1), 0) / Math.max(1, cluster.length);
      const stepDiff = Math.abs(avgStep - (ccAtp.stepNumber || 1));
      const adjustedSim = sim - stepDiff * 0.05;

      return { cIdx, sim, adjustedSim };
    });

    clusterScores.sort((a, b) => b.adjustedSim - a.adjustedSim);
    const bestScore = clusterScores[0];

    const targetClusterIndices = new Set<number>();
    if (bestScore && bestScore.cIdx !== undefined) {
      targetClusterIndices.add(bestScore.cIdx);
    }

    // Allow placement in multiple clusters if they have sufficient contextual relevance
    clusterScores.forEach((cs) => {
      if (cs.sim >= 3 && cs.sim >= (bestScore?.sim || 0) * 0.6) {
        targetClusterIndices.add(cs.cIdx);
      }
    });

    targetClusterIndices.forEach((cIdx) => {
      const targetCluster = semanticClusters[cIdx];
      if (targetCluster && !targetCluster.some((a) => a.id === ccAtp.id)) {
        targetCluster.push(ccAtp);
        targetCluster.sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0));
      }
    });
  });

  // Build Bab units from the semantic clusters
  const units: Array<{
    id: string;
    title: string;
    order: number;
    linkedTpIds: string[];
    linkedAtpItemIds: string[];
    materials: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    }>;
  }> = [];

  semanticClusters.forEach((cluster, cIdx) => {
    const unitOrder = cIdx + 1;
    const unitId = `unit-${Date.now()}-${unitOrder}`;
    
    const linkedAtpItemIds = cluster.map((a) => a.id);
    const linkedTpIdsSet = new Set<string>();
    cluster.forEach((a) => {
      const resolvedIds = resolveCanonicalAtpTpIds(a, validTpIdSet);
      resolvedIds.forEach((id) => linkedTpIdsSet.add(id));
    });

    const linkedTpIds = Array.from(linkedTpIdsSet);
    const linkedTps = linkedTpIds.map((id) => tpMap.get(id)).filter(Boolean) as Array<(typeof validTpItems)[0]>;

    // Determine representative Bab title from dominant content scope
    let mainTopic = '';
    const nonCrossCuttingTps = linkedTps.filter((t) => !isCrossCuttingTp(t));
    const titleCandidates = (nonCrossCuttingTps.length > 0 ? nonCrossCuttingTps : linkedTps)
      .map((t) => extractTopicFromTp(t))
      .filter((s) => s.length > 0);

    if (titleCandidates.length > 0) {
      mainTopic = titleCandidates[0];
    } else {
      mainTopic = `Materi Pembelajaran Bagian ${unitOrder}`;
    }

    const unitTitle = `Bab ${unitOrder}: ${mainTopic.replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '')}`;

    // Decompose into distinct supported Lingkup Materi
    const materials: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    }> = [];

    const distinctScopeMap = new Map<string, { tpIds: Set<string>; atpIds: Set<string> }>();

    // Build primary materials from non-cross-cutting TPs
    const nonCCTps = linkedTps.filter((tp) => !isCrossCuttingTp(tp));
    const ccTps = linkedTps.filter((tp) => isCrossCuttingTp(tp));

    const tpsToProcess = nonCCTps.length > 0 ? nonCCTps : linkedTps;
    tpsToProcess.forEach((tp) => {
      const scopeTitle = extractTopicFromTp(tp);
      const normalizedKey = scopeTitle.toLowerCase().trim();

      if (!distinctScopeMap.has(normalizedKey)) {
        distinctScopeMap.set(normalizedKey, { tpIds: new Set(), atpIds: new Set() });
      }

      const entry = distinctScopeMap.get(normalizedKey)!;
      entry.tpIds.add(tp.id);
      cluster
        .filter((a) => resolveCanonicalAtpTpIds(a, validTpIdSet).includes(tp.id))
        .forEach((a) => entry.atpIds.add(a.id));
    });

    // Match cross-cutting TPs to primary materials
    ccTps.forEach((ccTp) => {
      let matchedMaterialKey: string | null = null;
      let highestSim = 0;

      distinctScopeMap.forEach((entry, normKey) => {
        const firstTpId = Array.from(entry.tpIds)[0];
        const mTp = tpMap.get(firstTpId);
        if (!mTp) return;

        let sim = 0;
        if (ccTp.scopeCode && mTp.scopeCode && ccTp.scopeCode.trim().toUpperCase() === mTp.scopeCode.trim().toUpperCase()) {
          sim += 10;
        }
        const ccScope = (ccTp.contentScope || '').toLowerCase().trim();
        const mScope = (mTp.contentScope || '').toLowerCase().trim();
        if (ccScope && mScope && (ccScope === mScope || ccScope.includes(mScope) || mScope.includes(ccScope))) {
          sim += 5;
        }
        const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
        const kwMTp = extractKeywords(`${mTp.contentScope || ''} ${mTp.statement || ''}`);
        sim += kwCC.filter((k) => kwMTp.includes(k)).length;

        if (sim > highestSim && sim >= 2) {
          highestSim = sim;
          matchedMaterialKey = normKey;
        }
      });

      if (matchedMaterialKey) {
        const entry = distinctScopeMap.get(matchedMaterialKey)!;
        entry.tpIds.add(ccTp.id);
        cluster
          .filter((a) => resolveCanonicalAtpTpIds(a, validTpIdSet).includes(ccTp.id))
          .forEach((a) => entry.atpIds.add(a.id));
      }
    });

    let matIndex = 1;
    distinctScopeMap.forEach((entry, normKey) => {
      const originalTp = linkedTps.find((t) => extractTopicFromTp(t).toLowerCase().trim() === normKey);
      const title = originalTp ? extractTopicFromTp(originalTp) : normKey;

      const matTpIds = Array.from(entry.tpIds);
      const matAtpIds = Array.from(entry.atpIds);

      let finalMatAtpIds = matAtpIds;
      if (finalMatAtpIds.length === 0) {
        finalMatAtpIds = cluster
          .filter((a) => resolveCanonicalAtpTpIds(a, validTpIdSet).some((id) => matTpIds.includes(id)))
          .map((a) => a.id);
      }

      materials.push({
        id: `mat-${Date.now()}-${unitOrder}-${matIndex}`,
        title,
        order: matIndex,
        linkedTpIds: matTpIds,
        linkedAtpItemIds: finalMatAtpIds,
      });
      matIndex++;
    });

    if (materials.length === 0) {
      const nonCCTpIds = nonCCTps.map((t) => t.id);
      const fallbackTpIds = nonCCTpIds.length > 0 ? nonCCTpIds : linkedTpIds;
      const fallbackAtpIds = cluster
        .filter((a) => resolveCanonicalAtpTpIds(a, validTpIdSet).some((id) => fallbackTpIds.includes(id)))
        .map((a) => a.id);

      materials.push({
        id: `mat-${Date.now()}-${unitOrder}-1`,
        title: mainTopic.replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, ''),
        order: 1,
        linkedTpIds: fallbackTpIds,
        linkedAtpItemIds: fallbackAtpIds,
      });
    }

    units.push({
      id: unitId,
      title: unitTitle,
      order: unitOrder,
      linkedTpIds,
      linkedAtpItemIds,
      materials,
    });
  });

  const finalMapping = {
    id: `aum-${Date.now()}`,
    academicSettingId,
    atpId: atpData?.id || '',
    tpDataId: tpData?.id || '',
    units,
    basedOnTpUpdatedAt: tpData?.updatedAt,
    basedOnAtpUpdatedAt: atpData?.updatedAt,
    updatedAt: new Date().toISOString(),
  };

  return enforceCanonicalMappingInvariants(finalMapping, validTpItems, validAtpItems);
}

export function enforceCanonicalMappingInvariants(
  mapping: any,
  validTpItems: any[],
  validAtpItems: any[]
): any {
  if (!mapping || !Array.isArray(mapping.units)) return mapping;

  const validTpIdSet = new Set<string>(
    validTpItems
      .map((tp: any) => tp.id)
      .filter((id: any): id is string => typeof id === 'string' && id.trim().length > 0)
  );
  const tpMap = new Map<string, any>();
  validTpItems.forEach((tp) => tpMap.set(tp.id, tp));

  const atpMap = new Map<string, any>();
  validAtpItems.forEach((atp) => atpMap.set(atp.id, atp));

  const seenUnitIds = new Set<string>();
  const seenMaterialIds = new Set<string>();

  mapping.units.forEach((unit: any, uIdx: number) => {
    if (!unit.id || seenUnitIds.has(unit.id)) {
      unit.id = `unit-sanitized-${Date.now()}-${uIdx}-${Math.random().toString(36).substring(2, 6)}`;
    }
    seenUnitIds.add(unit.id);

    if (Array.isArray(unit.materials)) {
      unit.materials.forEach((mat: any, mIdx: number) => {
        if (!mat.id || seenMaterialIds.has(mat.id)) {
          mat.id = `mat-sanitized-${Date.now()}-${uIdx}-${mIdx}-${Math.random().toString(36).substring(2, 6)}`;
        }
        seenMaterialIds.add(mat.id);
      });
    }
  });

  // 1. Missing ATP Recovery: Ensure every canonical ATP appears in at least one Unit
  const coveredAtpItemIds = new Set<string>();
  mapping.units.forEach((u: any) => {
    (u.linkedAtpItemIds || []).forEach((id: string) => coveredAtpItemIds.add(id));
  });

  const missingAtpItems = validAtpItems.filter((atp) => !coveredAtpItemIds.has(atp.id));
  if (missingAtpItems.length > 0) {
    missingAtpItems.forEach((atp) => {
      const resolvedTpIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
      const atpTps = resolvedTpIds.map((id) => tpMap.get(id)).filter(Boolean);

      let bestUnit: any = null;
      let highestUnitSim = 0;

      mapping.units.forEach((u: any) => {
        let sim = 0;
        const uTps = (u.linkedTpIds || []).map((id: string) => tpMap.get(id)).filter(Boolean);
        atpTps.forEach((tp: any) => {
          uTps.forEach((uTp: any) => {
            if (tp.scopeCode && uTp.scopeCode && tp.scopeCode.trim().toUpperCase() === uTp.scopeCode.trim().toUpperCase()) {
              sim += 10;
            }
            const ccScope = (tp.contentScope || '').toLowerCase().trim();
            const uScope = (uTp.contentScope || '').toLowerCase().trim();
            if (ccScope && uScope && (ccScope === uScope || ccScope.includes(uScope) || uScope.includes(ccScope))) {
              sim += 5;
            }
            const kw1 = (tp.contentScope || tp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
            const kw2 = (uTp.contentScope || uTp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
            sim += kw1.filter((k: string) => kw2.includes(k)).length;
          });
        });

        if (sim > highestUnitSim) {
          highestUnitSim = sim;
          bestUnit = u;
        }
      });

      if (bestUnit && highestUnitSim >= 2) {
        if (!Array.isArray(bestUnit.linkedAtpItemIds)) bestUnit.linkedAtpItemIds = [];
        if (!bestUnit.linkedAtpItemIds.includes(atp.id)) {
          bestUnit.linkedAtpItemIds.push(atp.id);
        }

        let bestMat: any = null;
        let highestMatSim = 0;

        (bestUnit.materials || []).forEach((mat: any) => {
          let sim = 0;
          const matTps = (mat.linkedTpIds || []).map((id: string) => tpMap.get(id)).filter(Boolean);
          atpTps.forEach((tp: any) => {
            matTps.forEach((mTp: any) => {
              if (tp.scopeCode && mTp.scopeCode && tp.scopeCode.trim().toUpperCase() === mTp.scopeCode.trim().toUpperCase()) {
                sim += 10;
              }
              const ccScope = (tp.contentScope || '').toLowerCase().trim();
              const mScope = (mTp.contentScope || '').toLowerCase().trim();
              if (ccScope && mScope && (ccScope === mScope || ccScope.includes(mScope) || mScope.includes(ccScope))) {
                sim += 5;
              }
              const kw1 = (tp.contentScope || tp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
              const kw2 = (mTp.contentScope || mTp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
              sim += kw1.filter((k: string) => kw2.includes(k)).length;
            });
          });

          if (sim > highestMatSim) {
            highestMatSim = sim;
            bestMat = mat;
          }
        });

        if (bestMat && highestMatSim >= 2) {
          if (!Array.isArray(bestMat.linkedAtpItemIds)) bestMat.linkedAtpItemIds = [];
          if (!bestMat.linkedAtpItemIds.includes(atp.id)) {
            bestMat.linkedAtpItemIds.push(atp.id);
          }
        } else {
          const matOrder = (bestUnit.materials || []).length + 1;
          const firstTp = atpTps[0];
          const newMatTitle = firstTp?.contentScope || atp.focus || firstTp?.statement || `Materi ${matOrder}`;
          if (!Array.isArray(bestUnit.materials)) bestUnit.materials = [];
          bestUnit.materials.push({
            id: `mat-recovered-${Date.now()}-${bestUnit.id}-${matOrder}`,
            title: newMatTitle.length > 80 ? `${newMatTitle.substring(0, 77)}...` : newMatTitle,
            order: matOrder,
            linkedTpIds: resolvedTpIds.length > 0 ? [...resolvedTpIds] : [],
            linkedAtpItemIds: [atp.id],
          });
        }
      } else {
        const newUnitOrder = mapping.units.length + 1;
        const firstTp = atpTps[0];
        const uTopic = firstTp?.contentScope || atp.focus || firstTp?.statement || `Bagian ${newUnitOrder}`;
        const newUnitTitle = `Bab ${newUnitOrder}: ${uTopic.length > 60 ? `${uTopic.substring(0, 57)}...` : uTopic}`;
        const newUnitId = `unit-recovered-${Date.now()}-${newUnitOrder}`;

        mapping.units.push({
          id: newUnitId,
          title: newUnitTitle,
          order: newUnitOrder,
          linkedTpIds: resolvedTpIds.length > 0 ? [...resolvedTpIds] : [],
          linkedAtpItemIds: [atp.id],
          materials: [
            {
              id: `mat-recovered-${Date.now()}-${newUnitId}-1`,
              title: uTopic,
              order: 1,
              linkedTpIds: resolvedTpIds.length > 0 ? [...resolvedTpIds] : [],
              linkedAtpItemIds: [atp.id],
            },
          ],
        });
      }
    });
  }

  // 2. DETERMINISTIC LINK SANITIZATION (Multi-Unit ATP Lineage & TP Subset Preservation)
  mapping.units.forEach((unit: any) => {
    // A. Sanitize unit ATP IDs
    const validUnitAtpIds = Array.from(
      new Set<string>(
        (Array.isArray(unit.linkedAtpItemIds) ? unit.linkedAtpItemIds : []).filter((id: string) =>
          atpMap.has(id)
        )
      )
    );
    unit.linkedAtpItemIds = validUnitAtpIds;

    // B. supportedTpIds(unit) = union canonical TP of unit.linkedAtpItemIds
    const supportedTpIdSet = new Set<string>();
    validUnitAtpIds.forEach((atpId: string) => {
      const atp = atpMap.get(atpId);
      if (atp) {
        const resolvedIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
        resolvedIds.forEach((tpId) => supportedTpIdSet.add(tpId));
      }
    });

    // C. Preserve explicit valid subset of unit.linkedTpIds (never expand to all supportedTpIds)
    const explicitTpIds: string[] = Array.isArray(unit.linkedTpIds) ? unit.linkedTpIds : [];
    const sanitizedUnitTpIds = Array.from(
      new Set<string>(
        explicitTpIds.filter((id: string) => supportedTpIdSet.has(id))
      )
    );
    unit.linkedTpIds = sanitizedUnitTpIds;

    // D. Material normalization:
    // material.linkedAtpItemIds ⊆ unit.linkedAtpItemIds
    // material.linkedTpIds ⊆ unit.linkedTpIds
    // dan setiap material.linkedTpIds harus didukung ATP pada material.linkedAtpItemIds.
    if (Array.isArray(unit.materials)) {
      unit.materials.forEach((mat: any) => {
        const validMatAtpIds = Array.from(
          new Set<string>(
            (Array.isArray(mat.linkedAtpItemIds) ? mat.linkedAtpItemIds : []).filter(
              (id: string) => validUnitAtpIds.includes(id)
            )
          )
        );
        mat.linkedAtpItemIds = validMatAtpIds;

        const matSupportedTpSet = new Set<string>();
        validMatAtpIds.forEach((atpId: string) => {
          const atp = atpMap.get(atpId);
          if (atp) {
            const resolvedIds = resolveCanonicalAtpTpIds(atp, validTpIdSet);
            resolvedIds.forEach((tpId) => matSupportedTpSet.add(tpId));
          }
        });

        const validMatTpIds = Array.from(
          new Set<string>(
            (Array.isArray(mat.linkedTpIds) ? mat.linkedTpIds : []).filter(
              (id: string) => unit.linkedTpIds.includes(id) && matSupportedTpSet.has(id)
            )
          )
        );
        mat.linkedTpIds = validMatTpIds;
      });
    }
  });

  // 3. Ensure each Unit has at least 1 valid material (without fabricating fake lineage)
  mapping.units.forEach((unit: any, uIdx: number) => {
    if (!Array.isArray(unit.materials) || unit.materials.length === 0) {
      const fallbackTitle = unit.title
        ? unit.title.replace(/^Bab\s+\d+:\s*/i, '').trim() || `Materi Pokok ${uIdx + 1}`
        : `Materi Pokok ${uIdx + 1}`;
      unit.materials = [
        {
          id: `mat-auto-${Date.now()}-${uIdx + 1}-1`,
          title: fallbackTitle,
          order: 1,
          linkedTpIds: [],
          linkedAtpItemIds: [],
        },
      ];
    }
  });

  // 5. CHRONOLOGY NORMALIZATION & SORTING (Requirement 8 & 9)
  // For each unit: sort unit.linkedAtpItemIds by ATP.stepNumber ascending
  mapping.units.forEach((unit: any) => {
    if (Array.isArray(unit.linkedAtpItemIds)) {
      unit.linkedAtpItemIds.sort((aId: string, bId: string) => {
        const stepA = atpMap.get(aId)?.stepNumber ?? 999999;
        const stepB = atpMap.get(bId)?.stepNumber ?? 999999;
        return stepA - stepB;
      });
    }
  });

  // Sort Units based on minimum stepNumber of ATP assigned to the Unit
  mapping.units.sort((a: any, b: any) => {
    const aSteps = (a.linkedAtpItemIds || []).map((id: string) => atpMap.get(id)?.stepNumber ?? 999999);
    const bSteps = (b.linkedAtpItemIds || []).map((id: string) => atpMap.get(id)?.stepNumber ?? 999999);

    const minA = aSteps.length > 0 ? Math.min(...aSteps) : 999999;
    const minB = bSteps.length > 0 ? Math.min(...bSteps) : 999999;

    if (minA !== minB) {
      return minA - minB;
    }
    return (a.order || 0) - (b.order || 0);
  });

  // Renumber unit.order and materials.order
  mapping.units.forEach((unit: any, idx: number) => {
    unit.order = idx + 1;
    if (Array.isArray(unit.materials)) {
      unit.materials.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      unit.materials.forEach((mat: any, mIdx: number) => {
        mat.order = mIdx + 1;
      });
    }
  });

  return mapping;
}



