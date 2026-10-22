import { createMoney } from './money.vo';
import { createRelevanceScore } from './relevance-score.vo';
import {
  Location,
  ContractingEntity,
  SourceReference,
  OpportunityStatus,
  Requirement,
  MatchedFactor,
  Explanation,
  Change,
  Feedback,
  Analysis,
} from './opportunity.value-objects';

describe('Opportunity Value Objects', () => {
  describe('Money VO', () => {
    it('creates valid Money with non-negative amount and fixed COP currency', () => {
      const result = createMoney(150000000);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.amount).toBe(150000000);
        expect(result.value.currency).toBe('COP');
      }

      const zeroMoney = createMoney(0);
      expect(zeroMoney.ok).toBe(true);
      if (zeroMoney.ok) {
        expect(zeroMoney.value.amount).toBe(0);
      }
    });

    it('rejects negative amounts with a ValidationError', () => {
      const result = createMoney(-100);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('ValidationError');
        expect(result.error.fields).toContain('amount');
      }
    });

    it('rejects NaN and Infinity amounts with a ValidationError', () => {
      const nanResult = createMoney(NaN);
      expect(nanResult.ok).toBe(false);

      const infResult = createMoney(Infinity);
      expect(infResult.ok).toBe(false);
    });
  });

  describe('RelevanceScore VO', () => {
    it('creates valid RelevanceScore within [0, 1]', () => {
      const zero = createRelevanceScore(0);
      expect(zero.ok).toBe(true);

      const one = createRelevanceScore(1);
      expect(one.ok).toBe(true);

      const mid = createRelevanceScore(0.75);
      expect(mid.ok).toBe(true);
      if (mid.ok) {
        expect(mid.value).toBe(0.75);
      }
    });

    it('rejects scores less than 0 or greater than 1', () => {
      const below = createRelevanceScore(-0.01);
      expect(below.ok).toBe(false);
      if (!below.ok) {
        expect(below.error.fields).toContain('score');
      }

      const above = createRelevanceScore(1.001);
      expect(above.ok).toBe(false);
      if (!above.ok) {
        expect(above.error.fields).toContain('score');
      }
    });

    it('rejects non-finite score numbers', () => {
      expect(createRelevanceScore(NaN).ok).toBe(false);
      expect(createRelevanceScore(Infinity).ok).toBe(false);
    });
  });

  describe('Opportunity Domain Structures', () => {
    it('instantiates valid domain structures', () => {
      const location: Location = { city: 'Bogotá', department: 'Bogotá D.C.' };
      const entity: ContractingEntity = {
        name: 'Alcaldía Mayor',
        taxId: '899999061-9',
      };
      const source: SourceReference = {
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.2577563',
        humanReference: 'EDP-545-2022',
        originalUrl:
          'https://community.secop.gov.co/Public/Tenders/ContractNoticeManagement/Index?processId=2577563',
      };
      const status: OpportunityStatus = 'Published';
      const requirement: Requirement = {
        text: 'Certificación ISO 9001',
        type: 'technical',
      };
      const factor: MatchedFactor = {
        factor: 'categoryMatch',
        score: 1.0,
        description: 'Coincide con tu categoría de interés',
      };
      const explanation: Explanation = {
        summary: 'Alta afinidad por sector y presupuesto',
        matchedFactors: [factor],
      };
      const change: Change = {
        field: 'closingDate',
        previousValue: '2026-10-15',
        newValue: '2026-10-20',
        detectedAt: new Date(),
      };
      const feedback: Feedback = {
        decision: 'Participate',
        recordedAt: new Date(),
      };
      const analysis: Analysis = {
        summary: 'Servicios de desarrollo de software',
        requirements: [requirement],
        embeddingGeneratedAt: null,
      };

      expect(location.city).toBe('Bogotá');
      expect(entity.taxId).toBe('899999061-9');
      expect(source.sourceName).toBe('SECOP');
      expect(status).toBe('Published');
      expect(explanation.matchedFactors).toHaveLength(1);
      expect(change.field).toBe('closingDate');
      expect(feedback.decision).toBe('Participate');
      expect(analysis.embeddingGeneratedAt).toBeNull();
    });
  });
});
