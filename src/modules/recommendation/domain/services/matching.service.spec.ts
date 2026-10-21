import { MatchingService, ScoringWeights, cosine } from './matching.service';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { asOpportunityId, asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { Money, createMoney } from '../../../opportunity/domain/value-objects/money.vo';
import { HashEmbedder } from '../../../shared/testing/hash-embedder';

const mustCreateMoney = (amount: number): Money => {
  const result = createMoney(amount);
  if (!result.ok) throw new Error(`Money creation failed for ${amount}`);
  return result.value;
};

describe('MatchingService', () => {
  let service: MatchingService;

  const createTestOpportunity = (overrides?: Partial<Opportunity>): Opportunity => {
    return {
      id: asOpportunityId('opp-100'),
      title: 'Desarrollo de plataforma cloud',
      description: 'Implementación y despliegue de servicios cloud',
      contractingEntity: {
        name: 'Ministerio de Hacienda',
        taxId: '899999090-2',
      },
      location: {
        city: 'Bogotá',
        department: 'Bogotá D.C.',
      },
      amount: overrides?.amount ?? mustCreateMoney(100_000_000),
      amountKnown: true,
      contractType: 'Servicios',
      procurementModality: 'Licitación pública',
      isCompetitive: true,
      categoryCode: 'V1.43230000',
      publishedAt: new Date('2026-10-01'),
      lastPublishedAt: new Date('2026-10-01'),
      closingDate: new Date('2026-11-01'),
      isOpenForSubmission: true,
      status: 'Published',
      source: {
        sourceName: 'SECOP',
        externalId: 'CO1.REQ.12345',
        humanReference: 'MH-001',
        originalUrl: 'https://secop.gov.co/12345',
      },
      analysis: null,
      changeHistory: [],
      ...overrides,
    };
  };

  const createTestProfile = (overrides?: Partial<Profile>): Profile => ({
    id: asProfileId('prof-200'),
    ownerId: asUserId('user-300'),
    sector: 'Tecnología',
    capabilities: [{ name: 'Cloud Computing', yearsOfExperience: 5 }],
    preferences: {
      categoryCodes: ['V1.43230000'],
      keywords: ['cloud', 'aws', 'software'],
      amountRange: { min: 50_000_000, max: 150_000_000 },
      departments: ['Bogotá D.C.'],
    },
    ...overrides,
  });

  beforeEach(() => {
    service = new MatchingService();
  });

  describe('Pure cosine(a, b) and HashEmbedder', () => {
    it('computes cosine similarity of in-memory vectors', async () => {
      const embedder = new HashEmbedder();
      const [vecA, vecB, vecSame] = await embedder.embed([
        'Desarrollo de software en la nube',
        'Construccion de alcantarillado rural',
        'Desarrollo de software en la nube',
      ]);

      expect(cosine(vecA, vecSame)).toBeCloseTo(1.0, 6);
      expect(cosine(vecA, vecB)).toBeLessThan(0.5);
      expect(cosine([1, 0], [0, 1])).toBe(0);
    });
  });

  describe('Weighted Factor 1: Semantic Similarity (weight: 0.35)', () => {
    it('isolates semantic similarity factor with concrete numeric score 0.2800 for 0.80 similarity when all 4 factors are available', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999', // Mismatched category -> 0
        amount: mustCreateMoney(500_000_000), // Far outside range (>= 2x max) -> 0
        location: { city: 'Medellín', department: 'Antioquia' }, // Mismatched dept -> 0
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: ['cloud'],
          amountRange: { min: 50_000_000, max: 100_000_000 },
          departments: ['Valle del Cauca'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0.8);

      expect(breakdown.semanticSimilarity).toBe(0.8);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(0.0);
      expect(breakdown.unavailableFactors).toEqual([]);

      // Expected: 0.35 * 0.80 + 0.35 * 0.0 + 0.20 * 0.0 + 0.10 * 0.0 = 0.2800
      expect(breakdown.combinedScore).toBe(0.28);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'semanticSimilarity',
        score: 0.8,
        description:
          'Alta coincidencia semántica con las capacidades y palabras clave de tu perfil',
      });
      expect(breakdown.explanation.summary).toContain('Alta coincidencia semántica');
    });

    it('uses constructor-injected thresholds or explicit bounds for cosine normalization', () => {
      const customMatching = new MatchingService({
        semanticCosineLow: 0.5,
        semanticCosineHigh: 0.9,
        minRecommendationScore: 0.6,
      });

      expect(customMatching.semanticCosineLow).toBe(0.5);
      expect(customMatching.semanticCosineHigh).toBe(0.9);
      expect(customMatching.minRecommendationScore).toBe(0.6);
      expect(customMatching.getMinRecommendationScore()).toBe(0.6);

      expect(customMatching.normalizeCosine(0.5)).toBeCloseTo(0, 6);
      expect(customMatching.normalizeCosine(0.9)).toBeCloseTo(1, 6);
      expect(customMatching.normalizeCosine(0.7)).toBeCloseTo(0.5, 6);

      expect(MatchingService.normalizeCosine(0.4)).toBeCloseTo(0, 6);
      expect(MatchingService.normalizeCosine(0.75)).toBeCloseTo(1, 6);
      expect(MatchingService.normalizeCosine(0.7, 0.5, 0.9)).toBeCloseTo(0.5, 6);
    });
  });

  describe('Weighted Factor 2: Category Match (weight: 0.35)', () => {
    it('computes exact category match with concrete numeric score 0.3500 for 1.0 match', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43230000',
        amount: mustCreateMoney(500_000_000),
        location: { city: 'Cali', department: 'Valle del Cauca' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: { min: 10_000_000, max: 50_000_000 },
          departments: ['Santander'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(1.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(0.0);

      expect(breakdown.combinedScore).toBe(0.35);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'categoryMatch',
        score: 1.0,
        description: 'Coincide con tu categoría de interés',
      });
      expect(breakdown.explanation.summary).toContain('Coincide con tu categoría de interés');
    });

    it('computes partial category match (0.6) for shared UNSPSC segment/family prefix with score 0.2100', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43231500',
        amount: mustCreateMoney(500_000_000),
        location: { city: 'Cali', department: 'Valle del Cauca' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: { min: 10_000_000, max: 50_000_000 },
          departments: ['Santander'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);

      expect(breakdown.categoryMatch).toBe(0.6);
      expect(breakdown.combinedScore).toBe(0.21);
      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0].factor).toBe('categoryMatch');
      expect(breakdown.matchedFactors[0].score).toBe(0.6);
    });

    it('returns 0.0 for unrelated UNSPSC categories', async () => {
      const opportunity = createTestOpportunity({ categoryCode: 'V1.80111500' });
      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: null,
          departments: [],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);
      expect(breakdown.categoryMatch).toBe(0.0);
    });
  });

  describe('Weighted Factor 3: Relative Amount Fit (weight: 0.20)', () => {
    it('computes exact relative amountFit for profile range 50M to 500M: 623,560 -> 0.0125; 25M -> 0.5; 750M -> 0.5; 1,000M -> 0; 100M -> 1', async () => {
      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: { min: 50_000_000, max: 500_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      const cases: Array<{ amount: number; expected: number }> = [
        { amount: 623_560, expected: 0.0125 },
        { amount: 25_000_000, expected: 0.5 },
        { amount: 750_000_000, expected: 0.5 },
        { amount: 1_000_000_000, expected: 0 },
        { amount: 100_000_000, expected: 1 },
      ];

      for (const { amount, expected } of cases) {
        const opp = createTestOpportunity({ amount: mustCreateMoney(amount) });
        const breakdown = await service.computeBreakdown(opp, profile, 0);
        expect(breakdown.amountFit).toBe(expected);
      }
    });

    it('computes full amount fit (1.0) when amount is inside declared range with score 0.2000', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(100_000_000),
        location: { city: 'Cali', department: 'Valle del Cauca' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: [],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: ['Santander'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(1.0);
      expect(breakdown.locationMatch).toBe(0.0);
      expect(breakdown.combinedScore).toBe(0.2);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'amountFit',
        score: 1.0,
        description: 'El monto está dentro de tu rango declarado',
      });
      expect(breakdown.explanation.summary).toContain('El monto está dentro de tu rango declarado');
    });

    it('treats null amountRange or amountKnown=false as unavailable (not zero and not 1.0)', async () => {
      const opportunity = createTestOpportunity({
        amount: mustCreateMoney(0),
        amountKnown: false,
        categoryCode: 'V1.43230000',
        location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      // semantic=1.0 (0.35), category=1.0 (0.35), amount=unavailable, location=1.0 (0.10)
      // combinedScore = (0.35 + 0.35 + 0.10) / 0.80 = 1.0
      const breakdown = await service.computeBreakdown(opportunity, profile, 1.0);
      expect(breakdown.combinedScore).toBe(1.0);
      expect(breakdown.unavailableFactors).toContain('La oportunidad no declara un monto válido');
      expect(breakdown.matchedFactors.map((f) => f.factor)).not.toContain('amountFit');
    });
  });

  describe('Weighted Factor 4: Location Match (weight: 0.10)', () => {
    it('computes location match (1.0) when department matches with score 0.1000', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(500_000_000),
        location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: [],
          amountRange: { min: 10_000_000, max: 50_000_000 },
          departments: ['Bogotá D.C.', 'Cundinamarca'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(1.0);
      expect(breakdown.combinedScore).toBe(0.1);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'locationMatch',
        score: 1.0,
        description: 'La ubicación coincide con tus departamentos de interés',
      });
      expect(breakdown.explanation.summary).toContain(
        'La ubicación coincide con tus departamentos de interés',
      );
    });

    it('treats empty department preference as unavailable (ignored in denominator)', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(500_000_000),
        location: { city: 'Leticia', department: 'Amazonas' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: [],
          amountRange: { min: 10_000_000, max: 50_000_000 },
          departments: [],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);
      expect(breakdown.locationMatch).toBe(0);
      expect(breakdown.combinedScore).toBe(0);
      expect(breakdown.unavailableFactors).toContain(
        'El perfil no declara departamentos de interés',
      );
    });

    it('evaluates to 0.0 when department does not match profile preferences', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(500_000_000),
        location: { city: 'Medellín', department: 'Antioquia' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: [],
          amountRange: { min: 10_000_000, max: 50_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);
      expect(breakdown.locationMatch).toBe(0.0);
    });
  });

  describe('Unavailable Factors Renormalization & Combined Formula', () => {
    it('renormalizes the other three weights when category is unavailable and records Spanish reason', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: null, // Category unavailable!
        amount: mustCreateMoney(100_000_000), // amountFit = 1.0 (weight 0.20)
        location: { city: 'Bogotá', department: 'Bogotá D.C.' }, // locationMatch = 1.0 (weight 0.10)
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: ['cloud'],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      // semantic = 0.8 (weight 0.35)
      // Available weights sum = 0.35 + 0.20 + 0.10 = 0.65
      // Weighted numerator = 0.35 * 0.8 + 0.20 * 1.0 + 0.10 * 1.0 = 0.28 + 0.20 + 0.10 = 0.58
      // Expected score = 0.58 / 0.65 = 0.89230769... -> 0.8923
      const breakdown = await service.computeBreakdown(opportunity, profile, 0.8);

      expect(breakdown.combinedScore).toBe(0.8923);
      expect(breakdown.unavailableFactors).toEqual([
        'La oportunidad no declara categoría UNSPSC',
      ]);
      expect(breakdown.explanation.unavailableFactors).toEqual([
        'La oportunidad no declara categoría UNSPSC',
      ]);
      expect(breakdown.matchedFactors.map((f) => f.factor)).toEqual([
        'semanticSimilarity',
        'amountFit',
        'locationMatch',
      ]);
    });

    it('returns score = 0 when no factor is available', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: null,
        amountKnown: false,
      });
      const profile = createTestProfile({
        preferences: {
          categoryCodes: [],
          keywords: [],
          amountRange: null,
          departments: [],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, null);
      expect(breakdown.combinedScore).toBe(0);
      expect(breakdown.matchedFactors).toEqual([]);
      expect(breakdown.unavailableFactors.length).toBeGreaterThanOrEqual(4);
    });

    it('computes exact combined score when all 4 factors match with high scores (score: 0.9650)', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43230000',
        amount: mustCreateMoney(100_000_000),
        location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: ['cloud', 'software'],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      const recommendation = await service.score(opportunity, profile, 0.9);

      expect(recommendation.score).toBe(0.965);
      expect(recommendation.profileId).toBe(profile.id);
      expect(recommendation.opportunityId).toBe(opportunity.id);

      expect(recommendation.explanation.matchedFactors).toHaveLength(4);
      expect(recommendation.explanation.unavailableFactors).toEqual([]);

      const factorNames = recommendation.explanation.matchedFactors.map((f) => f.factor);
      expect(factorNames).toEqual([
        'semanticSimilarity',
        'categoryMatch',
        'amountFit',
        'locationMatch',
      ]);
    });

    it('filters out factors below the 0.6 threshold from matchedFactors', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43231500', // partial credit 0.6
        amount: mustCreateMoney(240_000_000), // 90M over 150M -> 1 - 90/150 = 0.40
        location: { city: 'Barranquilla', department: 'Atlántico' }, // mismatch -> 0
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: ['cloud'],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      const recommendation = await service.score(opportunity, profile, 0.7);

      expect(recommendation.score).toBe(0.535);
      expect(recommendation.explanation.matchedFactors).toHaveLength(2);
      expect(recommendation.explanation.matchedFactors.map((f) => f.factor)).toEqual([
        'semanticSimilarity',
        'categoryMatch',
      ]);
    });

    it('produces fallback summary when no factors meet the 0.6 threshold', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(900_000_000),
        location: { city: 'Barranquilla', department: 'Atlántico' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: ['cloud'],
          amountRange: { min: 50_000_000, max: 100_000_000 },
          departments: ['Bogotá D.C.'],
        },
      });

      const recommendation = await service.score(opportunity, profile, 0.2);

      expect(recommendation.explanation.matchedFactors).toHaveLength(0);
      expect(recommendation.explanation.summary).toBe(
        'Baja coincidencia general con los criterios del perfil.',
      );
    });

    it('returns 0.0 location match when opportunity department is null and profile specifies departments', async () => {
      const opportunity = createTestOpportunity({
        location: { city: null, department: null },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: [],
          keywords: [],
          amountRange: null,
          departments: ['Bogotá D.C.'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile, 0);
      expect(breakdown.locationMatch).toBe(0.0);
    });

    it('handles null semanticSimilarity by excluding semantic weight and renormalizing available factors', async () => {
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43230000',
        amount: mustCreateMoney(100_000_000),
        location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      });
      const profile = createTestProfile();

      const breakdown = await service.computeBreakdown(opportunity, profile, null);
      expect(breakdown.semanticSimilarity).toBe(0);
      expect(breakdown.categoryMatch).toBe(1.0);
      expect(breakdown.amountFit).toBe(1.0);
      expect(breakdown.locationMatch).toBe(1.0);
      expect(breakdown.combinedScore).toBe(1.0);
      expect(breakdown.unavailableFactors).toContain(
        'La oportunidad aún no tiene vector semántico indexado',
      );
    });

    it('supports custom weights', async () => {
      const customWeights: ScoringWeights = {
        semanticSimilarity: 0.6,
        categoryMatch: 0.0,
        amountFit: 0.0,
        locationMatch: 0.4,
      };

      const customService = new MatchingService(customWeights);

      const opportunity = createTestOpportunity({
        location: { city: 'Bogotá', department: 'Bogotá D.C.' },
      });
      const profile = createTestProfile({
        preferences: {
          categoryCodes: [],
          keywords: ['cloud'],
          amountRange: null,
          departments: ['Bogotá D.C.'],
        },
      });

      const recommendation = await customService.score(opportunity, profile, 0.9);

      expect(recommendation.score).toBe(0.94);
    });
  });
});
