import {
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../shared/domain/typed-id';
import {
  createRecommendation,
  withRecommendationFeedback,
} from './recommendation.entity';
import {
  Explanation,
  Feedback,
} from '../../../opportunity/domain/value-objects/opportunity.value-objects';

describe('Recommendation Entity', () => {
  const explanation: Explanation = {
    summary: 'Fuerte coincidencia semántica y de presupuesto',
    matchedFactors: [
      {
        factor: 'semanticSimilarity',
        score: 0.85,
        description: 'Alta afinidad técnica',
      },
      {
        factor: 'amountFit',
        score: 1.0,
        description: 'Monto dentro de rango',
      },
    ],
  };

  it('creates a valid Recommendation aggregate root', () => {
    const rec = createRecommendation({
      id: asRecommendationId('rec-001'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      score: 0.88,
      explanation,
    });

    expect(rec.ok).toBe(true);
    if (rec.ok) {
      expect(rec.value.id).toBe('rec-001');
      expect(rec.value.score).toBe(0.88);
      expect(rec.value.feedback).toBeNull();
      expect(rec.value.explanation.matchedFactors).toHaveLength(2);
    }
  });

  it('rejects creation when required fields are missing', () => {
    const invalid = createRecommendation({
      id: asRecommendationId(''),
      profileId: asProfileId(''),
      opportunityId: asOpportunityId(''),
      score: NaN,
      explanation: { summary: '', matchedFactors: [] },
    });

    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error.fields).toContain('id');
      expect(invalid.error.fields).toContain('profileId');
      expect(invalid.error.fields).toContain('opportunityId');
      expect(invalid.error.fields).toContain('score');
      expect(invalid.error.fields).toContain('explanation');
    }
  });

  it('rejects invalid scores outside [0, 1]', () => {
    const negative = createRecommendation({
      id: asRecommendationId('rec-001'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      score: -0.1,
      explanation,
    });
    expect(negative.ok).toBe(false);

    const over = createRecommendation({
      id: asRecommendationId('rec-001'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      score: 1.1,
      explanation,
    });
    expect(over.ok).toBe(false);
  });

  it('attaches feedback via withRecommendationFeedback', () => {
    const rec = createRecommendation({
      id: asRecommendationId('rec-001'),
      profileId: asProfileId('prof-001'),
      opportunityId: asOpportunityId('opp-001'),
      score: 0.88,
      explanation,
    });
    if (!rec.ok) throw new Error('Rec creation failed');

    const feedback: Feedback = {
      decision: 'Participate',
      recordedAt: new Date('2026-10-02T14:00:00.000Z'),
    };

    const updated = withRecommendationFeedback(rec.value, feedback);
    expect(updated.feedback).toEqual(feedback);
    expect(rec.value.feedback).toBeNull();
  });
});
