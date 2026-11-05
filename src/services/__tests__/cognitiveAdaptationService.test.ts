import { describe, it, expect } from 'vitest';
import {
  getCognitiveAdaptationProfile,
  resolveGrade,
  resolvePhaseForGrade,
} from '../cognitiveAdaptationService';

describe('CognitiveAdaptationService', () => {
  describe('resolveGrade', () => {
    it('resolves integer grades safely', () => {
      expect(resolveGrade(null, 1)).toBe(1);
      expect(resolveGrade(null, 6)).toBe(6);
      expect(resolveGrade(null, 12)).toBe(12);
    });

    it('parses Arabic grade strings with prefixes', () => {
      expect(resolveGrade(null, 'Kelas 1')).toBe(1);
      expect(resolveGrade(null, 'kls 4')).toBe(4);
      expect(resolveGrade(null, 'Grade 7')).toBe(7);
      expect(resolveGrade(null, '10')).toBe(10);
    });

    it('parses Roman grade strings with prefixes', () => {
      expect(resolveGrade(null, 'I')).toBe(1);
      expect(resolveGrade(null, 'Kelas IV')).toBe(4);
      expect(resolveGrade(null, 'kls VI')).toBe(6);
      expect(resolveGrade(null, 'VII')).toBe(7);
      expect(resolveGrade(null, 'Kelas XII')).toBe(12);
    });

    it('fails closed on invalid, out of bounds, or ambiguous grades', () => {
      expect(resolveGrade(null, 0)).toBeUndefined();
      expect(resolveGrade(null, 13)).toBeUndefined();
      expect(resolveGrade(null, '4-5')).toBeUndefined();
      expect(resolveGrade(null, '4/5')).toBeUndefined();
      expect(resolveGrade(null, 'TK')).toBeUndefined();
      expect(resolveGrade(null, '')).toBeUndefined();
    });

    it('resolves grade from AcademicSetting object', () => {
      expect(resolveGrade({ grade: 5 } as any)).toBe(5);
      expect(resolveGrade({ grade: 'Kelas 8' } as any)).toBe(8);
      expect(resolveGrade({ grade: 'IX' } as any)).toBe(9);
    });
  });

  describe('resolvePhaseForGrade', () => {
    it('resolves standard curriculum phases', () => {
      expect(resolvePhaseForGrade(1)).toBe('Fase A');
      expect(resolvePhaseForGrade(2)).toBe('Fase A');
      expect(resolvePhaseForGrade(3)).toBe('Fase B');
      expect(resolvePhaseForGrade(4)).toBe('Fase B');
      expect(resolvePhaseForGrade(5)).toBe('Fase C');
      expect(resolvePhaseForGrade(6)).toBe('Fase C');
      expect(resolvePhaseForGrade(7)).toBe('Fase D');
      expect(resolvePhaseForGrade(8)).toBe('Fase D');
      expect(resolvePhaseForGrade(9)).toBe('Fase D');
      expect(resolvePhaseForGrade(10)).toBe('Fase E');
      expect(resolvePhaseForGrade(11)).toBe('Fase F');
      expect(resolvePhaseForGrade(12)).toBe('Fase F');
    });
  });

  describe('getCognitiveAdaptationProfile', () => {
    it('calibrates Fase A (Grade 1-2) with concrete abstraction, very low reading load, high scaffolding', () => {
      const p1 = getCognitiveAdaptationProfile(null, 1);
      expect(p1).toBeDefined();
      expect(p1?.grade).toBe(1);
      expect(p1?.phase).toBe('Fase A');
      expect(p1?.abstractionLevel).toBe('CONCRETE');
      expect(p1?.languageLoad).toBe('VERY_LOW');
      expect(p1?.readingLoad).toBe('VERY_LOW');
      expect(p1?.instructionComplexity).toBe('SINGLE_STEP_PREFERRED');
      expect(p1?.instructionLoad).toBe('SINGLE_STEP_PREFERRED');
      expect(p1?.visualSupport).toBe('STRONGLY_CONSIDER');
      expect(p1?.scaffoldingLevel).toBe('HIGH');
      expect(p1?.pedagogicalGuidelines?.length).toBeGreaterThan(0);

      const p2 = getCognitiveAdaptationProfile(null, 2);
      expect(p2?.abstractionLevel).toBe('CONCRETE');
      expect(p2?.scaffoldingLevel).toBe('HIGH');
    });

    it('calibrates Fase B (Grade 3-4) with concrete abstraction, low reading load, moderate scaffolding', () => {
      const p3 = getCognitiveAdaptationProfile(null, 3);
      expect(p3).toBeDefined();
      expect(p3?.phase).toBe('Fase B');
      expect(p3?.abstractionLevel).toBe('CONCRETE');
      expect(p3?.languageLoad).toBe('LOW');
      expect(p3?.instructionComplexity).toBe('LIMITED_MULTI_STEP');
      expect(p3?.scaffoldingLevel).toBe('MODERATE');
      expect(p3?.visualSupport).toBe('CONSIDER');
    });

    it('calibrates Fase C (Grade 5-6) with concrete-to-abstract transition, moderate language load', () => {
      const p6 = getCognitiveAdaptationProfile(null, 6);
      expect(p6).toBeDefined();
      expect(p6?.phase).toBe('Fase C');
      expect(p6?.abstractionLevel).toBe('CONCRETE_TO_ABSTRACT');
      expect(p6?.languageLoad).toBe('MODERATE');
      expect(p6?.readingLoad).toBe('MODERATE');
      expect(p6?.instructionComplexity).toBe('LIMITED_MULTI_STEP');
      expect(p6?.scaffoldingLevel).toBe('MODERATE');
      expect(p6?.visualSupport).toBe('CONSIDER');
    });

    it('calibrates Fase D (Grade 7-9) with multi-step allowed and low scaffolding', () => {
      const p9 = getCognitiveAdaptationProfile(null, 9);
      expect(p9).toBeDefined();
      expect(p9?.phase).toBe('Fase D');
      expect(p9?.abstractionLevel).toBe('CONCRETE_TO_ABSTRACT');
      expect(p9?.languageLoad).toBe('MODERATE');
      expect(p9?.instructionComplexity).toBe('MULTI_STEP_ALLOWED');
      expect(p9?.scaffoldingLevel).toBe('LOW');
      expect(p9?.visualSupport).toBe('AS_NEEDED');
    });

    it('calibrates Fase E & F (Grade 10-12) with abstract allowed, high language load, low scaffolding', () => {
      const p10 = getCognitiveAdaptationProfile(null, 10);
      expect(p10).toBeDefined();
      expect(p10?.phase).toBe('Fase E');
      expect(p10?.abstractionLevel).toBe('ABSTRACT_ALLOWED');
      expect(p10?.languageLoad).toBe('HIGH');
      expect(p10?.readingLoad).toBe('HIGH');
      expect(p10?.instructionComplexity).toBe('MULTI_STEP_ALLOWED');
      expect(p10?.scaffoldingLevel).toBe('LOW');
      expect(p10?.visualSupport).toBe('AS_NEEDED');

      const p12 = getCognitiveAdaptationProfile(null, 12);
      expect(p12?.phase).toBe('Fase F');
      expect(p12?.abstractionLevel).toBe('ABSTRACT_ALLOWED');
    });

    it('returns undefined fail-closed when grade cannot be resolved', () => {
      expect(getCognitiveAdaptationProfile(null, undefined)).toBeUndefined();
      expect(getCognitiveAdaptationProfile(null, 'invalid')).toBeUndefined();
    });
  });
});
