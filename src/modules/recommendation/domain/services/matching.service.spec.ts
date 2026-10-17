import { MatchingService, DEFAULT_SCORING_WEIGHTS, ScoringWeights } from './matching.service';
import { AIProviderPort } from '../ports/ai-provider.port';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { asOpportunityId, asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { Money, createMoney } from '../../../opportunity/domain/value-objects/money.vo';

class FakeAIProvider implements AIProviderPort {
  constructor(private similarity: number = 0) {}

  setSimilarity(similarity: number): void {
    this.similarity = similarity;
  }

  async embed(_text: string): Promise<number[]> {
    return [];
  }

  async scoreSimilarity(_textA: string, _textB: string): Promise<number> {
    return this.similarity;
  }

  async summarize(_text: string): Promise<string> {
    return '';
  }
}

const mustCreateMoney = (amount: number): Money => {
  const result = createMoney(amount);
  if (!result.ok) throw new Error(`Money creation failed for ${amount}`);
  return result.value;
};

describe('MatchingService', () => {
  let fakeAiProvider: FakeAIProvider;
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
    fakeAiProvider = new FakeAIProvider(0);
    service = new MatchingService(fakeAiProvider);
  });

  describe('Weighted Factor 1: Semantic Similarity (weight: 0.35)', () => {
    it('isolates semantic similarity factor with concrete numeric score 0.2800 for 0.80 similarity', async () => {
      fakeAiProvider.setSimilarity(0.8);

      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999', // Mismatched category -> 0
        amount: mustCreateMoney(500_000_000), // Far outside range -> 0
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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.semanticSimilarity).toBe(0.8);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(0.0);

      // Expected: 0.35 * 0.80 + 0.35 * 0.0 + 0.20 * 0.0 + 0.10 * 0.0 = 0.2800
      expect(breakdown.combinedScore).toBe(0.28);

      // Matched factor threshold check: semanticSimilarity >= 0.6 should be listed
      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'semanticSimilarity',
        score: 0.8,
        description: 'Alta coincidencia semántica con las capacidades y palabras clave de tu perfil',
      });
      expect(breakdown.explanation.summary).toContain('Alta coincidencia semántica');
    });
  });

  describe('Weighted Factor 2: Category Match (weight: 0.35)', () => {
    it('computes exact category match with concrete numeric score 0.3500 for 1.0 match', async () => {
      fakeAiProvider.setSimilarity(0);

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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(1.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(0.0);

      // Expected: 0.35 * 0.0 + 0.35 * 1.0 + 0.20 * 0.0 + 0.10 * 0.0 = 0.3500
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
      fakeAiProvider.setSimilarity(0);

      // Same segment (43) and family (23), differing class/commodity: 43231500 vs 43230000
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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.categoryMatch).toBe(0.6);
      // Expected: 0.35 * 0.6 = 0.2100
      expect(breakdown.combinedScore).toBe(0.21);

      // Since 0.6 >= threshold, it is listed in matchedFactors
      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0].factor).toBe('categoryMatch');
      expect(breakdown.matchedFactors[0].score).toBe(0.6);
    });

    it('returns 0.0 for unrelated UNSPSC categories', async () => {
      fakeAiProvider.setSimilarity(0);

      const opportunity = createTestOpportunity({ categoryCode: 'V1.80111500' });
      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.43230000'],
          keywords: [],
          amountRange: null,
          departments: [],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.categoryMatch).toBe(0.0);
    });
  });

  describe('Weighted Factor 3: Amount Fit (weight: 0.20)', () => {
    it('computes full amount fit (1.0) when amount is inside declared range with score 0.2000', async () => {
      fakeAiProvider.setSimilarity(0);

      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(100_000_000), // exactly in [50M, 150M]
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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(1.0);
      expect(breakdown.locationMatch).toBe(0.0);

      // Expected: 0.20 * 1.0 = 0.2000
      expect(breakdown.combinedScore).toBe(0.2);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'amountFit',
        score: 1.0,
        description: 'El monto está dentro de tu rango declarado',
      });
      expect(breakdown.explanation.summary).toContain('El monto está dentro de tu rango declarado');
    });

    it('computes triangular falloff for amount just outside range with concrete numeric calculation', async () => {
      fakeAiProvider.setSimilarity(0);

      // Range: [50M, 150M]. Range span = 100M. Margin = 100M.
      // Opportunity amount: 170M (20M over max).
      // Falloff = 1 - (20M / 100M) = 0.80.
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.99999999',
        amount: mustCreateMoney(170_000_000),
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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.amountFit).toBe(0.8);
      // Expected: 0.20 * 0.80 = 0.1600
      expect(breakdown.combinedScore).toBe(0.16);

      // 0.80 >= 0.6 threshold -> matchedFactors includes amountFit
      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0].factor).toBe('amountFit');
      expect(breakdown.matchedFactors[0].score).toBe(0.8);
    });

    it('drops to 0.0 amount fit for amounts far beyond the falloff margin', async () => {
      fakeAiProvider.setSimilarity(0);

      // Range: [50M, 150M]. Margin = 100M. Max + margin = 250M.
      // Amount: 300M (> 250M) -> falloff = 0.0.
      const opportunity = createTestOpportunity({
        amount: mustCreateMoney(300_000_000),
        categoryCode: 'V1.99999999',
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

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.combinedScore).toBe(0.0);
      expect(breakdown.matchedFactors).toHaveLength(0);
    });

    it('treats null amountRange as neutral full match (1.0)', async () => {
      fakeAiProvider.setSimilarity(0);

      const opportunity = createTestOpportunity({
        amount: mustCreateMoney(999_000_000),
        categoryCode: 'V1.99999999',
        location: { city: 'Cali', department: 'Valle del Cauca' },
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: ['V1.11111111'],
          keywords: [],
          amountRange: null, // no amount preference
          departments: ['Santander'],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.amountFit).toBe(1.0);
      expect(breakdown.combinedScore).toBe(0.2);
    });
  });

  describe('Weighted Factor 4: Location Match (weight: 0.10)', () => {
    it('computes location match (1.0) when department matches with score 0.1000', async () => {
      fakeAiProvider.setSimilarity(0);

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

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.semanticSimilarity).toBe(0.0);
      expect(breakdown.categoryMatch).toBe(0.0);
      expect(breakdown.amountFit).toBe(0.0);
      expect(breakdown.locationMatch).toBe(1.0);

      // Expected: 0.10 * 1.0 = 0.1000
      expect(breakdown.combinedScore).toBe(0.1);

      expect(breakdown.matchedFactors).toHaveLength(1);
      expect(breakdown.matchedFactors[0]).toEqual({
        factor: 'locationMatch',
        score: 1.0,
        description: 'La ubicación coincide con tus departamentos de interés',
      });
      expect(breakdown.explanation.summary).toContain('La ubicación coincide con tus departamentos de interés');
    });

    it('treats empty department preference as any (1.0)', async () => {
      fakeAiProvider.setSimilarity(0);

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
          departments: [], // no preference -> "any"
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.locationMatch).toBe(1.0);
      expect(breakdown.combinedScore).toBe(0.1);
    });

    it('evaluates to 0.0 when department does not match profile preferences', async () => {
      fakeAiProvider.setSimilarity(0);

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

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.locationMatch).toBe(0.0);
    });
  });

  describe('Combined Formula and Explanation Verification', () => {
    it('computes exact combined score when all 4 factors match with high scores (score: 0.9650)', async () => {
      // Factors:
      // semanticSimilarity = 0.90 -> 0.35 * 0.90 = 0.3150
      // categoryMatch      = 1.00 -> 0.35 * 1.00 = 0.3500
      // amountFit          = 1.00 -> 0.20 * 1.00 = 0.2000
      // locationMatch      = 1.00 -> 0.10 * 1.00 = 0.1000
      // Combined = 0.3150 + 0.3500 + 0.2000 + 0.1000 = 0.9650
      fakeAiProvider.setSimilarity(0.9);

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

      const recommendation = await service.score(opportunity, profile);

      expect(recommendation.score).toBe(0.965);
      expect(recommendation.profileId).toBe(profile.id);
      expect(recommendation.opportunityId).toBe(opportunity.id);

      // All 4 factors are >= 0.6 threshold
      expect(recommendation.explanation.matchedFactors).toHaveLength(4);

      const factorNames = recommendation.explanation.matchedFactors.map((f) => f.factor);
      expect(factorNames).toEqual([
        'semanticSimilarity',
        'categoryMatch',
        'amountFit',
        'locationMatch',
      ]);

      expect(recommendation.explanation.summary).toContain('Alta coincidencia semántica');
      expect(recommendation.explanation.summary).toContain('Coincide con tu categoría de interés');
      expect(recommendation.explanation.summary).toContain('El monto está dentro de tu rango declarado');
      expect(recommendation.explanation.summary).toContain('La ubicación coincide con tus departamentos de interés');
    });

    it('filters out factors below the 0.6 threshold from matchedFactors (score: 0.5350)', async () => {
      // Factors:
      // semanticSimilarity = 0.70 (>= 0.6) -> 0.35 * 0.70 = 0.2450
      // categoryMatch      = 0.60 (>= 0.6) -> 0.35 * 0.60 = 0.2100
      // amountFit          = 0.40 (<  0.6) -> 0.20 * 0.40 = 0.0800
      // locationMatch      = 0.00 (<  0.6) -> 0.10 * 0.00 = 0.0000
      // Combined = 0.2450 + 0.2100 + 0.0800 + 0 = 0.5350
      fakeAiProvider.setSimilarity(0.7);

      // Amount: min=50M, max=150M. Range=100M. Diff=60M. Falloff = 1 - 60/100 = 0.40.
      const opportunity = createTestOpportunity({
        categoryCode: 'V1.43231500', // partial credit 0.6
        amount: mustCreateMoney(210_000_000), // 60M over 150M -> falloff 0.40
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

      const recommendation = await service.score(opportunity, profile);

      expect(recommendation.score).toBe(0.535);

      // Only factors with score >= 0.6 must be listed
      expect(recommendation.explanation.matchedFactors).toHaveLength(2);
      expect(recommendation.explanation.matchedFactors.map((f) => f.factor)).toEqual([
        'semanticSimilarity',
        'categoryMatch',
      ]);

      // Summary must not mention amount or location
      expect(recommendation.explanation.summary).not.toContain('El monto está dentro de tu rango');
      expect(recommendation.explanation.summary).not.toContain('La ubicación coincide');
    });

    it('produces fallback summary when no factors meet the 0.6 threshold', async () => {
      fakeAiProvider.setSimilarity(0.2);

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

      const recommendation = await service.score(opportunity, profile);

      expect(recommendation.explanation.matchedFactors).toHaveLength(0);
      expect(recommendation.explanation.summary).toBe('Baja coincidencia general con los criterios del perfil.');
    });

    it('computes triangular falloff when opportunity amount is slightly below min range', async () => {
      fakeAiProvider.setSimilarity(0);

      // Range: [50M, 150M]. Margin = 100M.
      // Opportunity amount: 40M (10M below min 50M).
      // Falloff = 1 - (10M / 100M) = 0.90.
      const opportunity = createTestOpportunity({
        amount: mustCreateMoney(40_000_000),
      });

      const profile = createTestProfile({
        preferences: {
          categoryCodes: [],
          keywords: [],
          amountRange: { min: 50_000_000, max: 150_000_000 },
          departments: [],
        },
      });

      const breakdown = await service.computeBreakdown(opportunity, profile);

      expect(breakdown.amountFit).toBe(0.9);
      // 0.20 * 0.90 + 0.10 * 1.0 (any dept) = 0.18 + 0.10 = 0.2800
      expect(breakdown.combinedScore).toBe(0.28);
      expect(breakdown.matchedFactors.some((f) => f.factor === 'amountFit')).toBe(true);
    });

    it('returns 0.0 location match when opportunity department is null and profile specifies departments', async () => {
      fakeAiProvider.setSimilarity(0);

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

      const breakdown = await service.computeBreakdown(opportunity, profile);
      expect(breakdown.locationMatch).toBe(0.0);
    });

    it('includes analysis summary in opportunityText when analysis is present', async () => {
      let passedOppText = '';
      const spyProvider: AIProviderPort = {
        embed: async () => [],
        scoreSimilarity: async (_textA: string, textB: string) => {
          passedOppText = textB;
          return 0.85;
        },
        summarize: async () => '',
      };

      const spyService = new MatchingService(spyProvider);
      const opportunity = createTestOpportunity({
        title: 'Contrato de IA',
        analysis: {
          summary: 'Servicios de machine learning en la nube',
          requirements: [],
          embeddingGeneratedAt: new Date(),
        },
      });
      const profile = createTestProfile({
        preferences: {
          categoryCodes: [],
          keywords: ['ia'],
          amountRange: null,
          departments: [],
        },
      });

      await spyService.score(opportunity, profile);
      expect(passedOppText).toBe('Contrato de IA. Servicios de machine learning en la nube');
    });

    it('supports custom weights (extensibility for LearningService in Phase 2)', async () => {
      // Custom weights emphasizing semantic similarity (0.60) and location (0.40)
      const customWeights: ScoringWeights = {
        semanticSimilarity: 0.6,
        categoryMatch: 0.0,
        amountFit: 0.0,
        locationMatch: 0.4,
      };

      const customService = new MatchingService(fakeAiProvider, customWeights);
      fakeAiProvider.setSimilarity(0.9);

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

      const recommendation = await customService.score(opportunity, profile);

      // Expected: 0.60 * 0.90 + 0.40 * 1.0 = 0.5400 + 0.4000 = 0.9400
      expect(recommendation.score).toBe(0.94);
    });
  });
});

