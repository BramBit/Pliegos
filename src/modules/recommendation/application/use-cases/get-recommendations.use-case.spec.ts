import { GetRecommendationsUseCase } from './get-recommendations.use-case';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { MatchingService } from '../../domain/services/matching.service';
import { AIProviderPort } from '../../domain/ports/ai-provider.port';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Recommendation } from '../../domain/entities/recommendation.entity';
import { OpportunityFilters } from '../../../opportunity/domain/value-objects/opportunity-filters';
import {
  ProfileId,
  OpportunityId,
  RecommendationId,
  asProfileId,
  asOpportunityId,
  asUserId,
} from '../../../shared/domain/typed-id';
import { createMoney } from '../../../opportunity/domain/value-objects/money.vo';

class FakeProfileRepo implements ProfileRepositoryPort {
  public profiles: Map<string, Profile> = new Map();

  async save(profile: Profile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async findById(id: ProfileId): Promise<Profile | null> {
    return this.profiles.get(id) ?? null;
  }
}

class FakeOpportunityRepo implements OpportunityRepositoryPort {
  public opportunities: Opportunity[] = [];

  async save(opportunity: Opportunity): Promise<void> {
    this.opportunities.push(opportunity);
  }

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    return this.opportunities.find((o) => o.id === id) ?? null;
  }

  async findByExternalId(_externalId: string): Promise<Opportunity | null> {
    return null;
  }

  async findByFilters(_filters: OpportunityFilters): Promise<Opportunity[]> {
    return this.opportunities;
  }
}

class FakeRecommendationRepo implements RecommendationRepositoryPort {
  public recommendations: Recommendation[] = [];

  async save(recommendation: Recommendation): Promise<void> {
    this.recommendations.push(recommendation);
  }

  async findByProfile(profileId: ProfileId): Promise<Recommendation[]> {
    return this.recommendations.filter((r) => r.profileId === profileId);
  }

  async findById(id: RecommendationId): Promise<Recommendation | null> {
    return this.recommendations.find((r) => r.id === id) ?? null;
  }
}

class FakeAI implements AIProviderPort {
  async embed(_text: string): Promise<number[]> {
    return [];
  }
  async scoreSimilarity(textA: string, textB: string): Promise<number> {
    if (textB.includes('Software')) return 0.9;
    return 0.2;
  }
  async summarize(_text: string): Promise<string> {
    return '';
  }
}

const mustCreateMoney = (amount: number) => {
  const result = createMoney(amount);
  if (!result.ok) throw new Error(`Money failed for ${amount}`);
  return result.value;
};

describe('GetRecommendationsUseCase', () => {
  let profileRepo: FakeProfileRepo;
  let oppRepo: FakeOpportunityRepo;
  let recRepo: FakeRecommendationRepo;
  let matchingService: MatchingService;
  let useCase: GetRecommendationsUseCase;

  const testProfile: Profile = {
    id: asProfileId('profile-1'),
    ownerId: asUserId('user-1'),
    sector: 'Tecnología',
    capabilities: [{ name: 'Desarrollo Web', yearsOfExperience: 4 }],
    preferences: {
      categoryCodes: ['V1.43230000'],
      keywords: ['Software'],
      amountRange: { min: 50_000_000, max: 150_000_000 },
      departments: ['Bogotá D.C.'],
    },
  };

  const oppHigh: Opportunity = {
    id: asOpportunityId('opp-high'),
    title: 'Desarrollo de Software a la medida',
    contractingEntity: { name: 'Ministerio de TIC', taxId: '800' },
    location: { city: 'Bogotá', department: 'Bogotá D.C.' },
    amount: mustCreateMoney(100_000_000),
    contractType: 'Servicios',
    procurementModality: 'Licitación',
    categoryCode: 'V1.43230000',
    publishedAt: new Date(),
    closingDate: new Date(),
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: '1',
      humanReference: 'H1',
      originalUrl: '',
    },
    analysis: null,
    changeHistory: [],
  };

  const oppLow: Opportunity = {
    ...oppHigh,
    id: asOpportunityId('opp-low'),
    title: 'Construcción de puente vehicular',
    categoryCode: 'V1.72141100',
    amount: mustCreateMoney(900_000_000),
    location: { city: 'Cali', department: 'Valle del Cauca' },
  };

  beforeEach(() => {
    profileRepo = new FakeProfileRepo();
    oppRepo = new FakeOpportunityRepo();
    recRepo = new FakeRecommendationRepo();
    matchingService = new MatchingService(new FakeAI());
    useCase = new GetRecommendationsUseCase(
      profileRepo,
      oppRepo,
      recRepo,
      matchingService,
    );
  });

  it('returns ProfileNotFoundError when profile is not registered', async () => {
    const result = await useCase.execute({
      profileId: asProfileId('non-existent'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('ProfileNotFoundError');
      expect(result.error.profileId).toBe('non-existent');
    }
  });

  it('retrieves candidate opportunities, scores them, ranks them descending by score, and saves to repository', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppLow);
    await oppRepo.save(oppHigh);

    const result = await useCase.execute({
      profileId: testProfile.id,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      // High match should be first
      expect(result.value[0].opportunityId).toBe('opp-high');
      expect(result.value[1].opportunityId).toBe('opp-low');
      expect(result.value[0].score).toBeGreaterThan(result.value[1].score);
    }

    // Verified saved in repository
    expect(recRepo.recommendations).toHaveLength(2);
  });
});
