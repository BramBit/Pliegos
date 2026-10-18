import { GetRecommendationsUseCase, CANDIDATE_POOL_SIZE } from './get-recommendations.use-case';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import {
  SearchIndexPort,
  CandidateRetrievalQuery,
  CandidateRetrievalFilters,
  CandidateRetrievalResult,
  reciprocalRankFusion,
} from '../../../opportunity/domain/ports/search-index.port';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { MatchingService, cosine } from '../../domain/services/matching.service';
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
import { HashEmbedder } from '../../../shared/testing/hash-embedder';

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

  async saveMany(opportunities: Opportunity[]): Promise<void> {
    this.opportunities.push(...opportunities);
  }

  async saveAnalysis(id: OpportunityId, analysis: Opportunity['analysis']): Promise<void> {
    const idx = this.opportunities.findIndex((o) => o.id === id);
    if (idx >= 0) {
      this.opportunities[idx] = { ...this.opportunities[idx], analysis };
    }
  }

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    return this.opportunities.find((o) => o.id === id) ?? null;
  }

  async findByExternalId(_externalId: string): Promise<Opportunity | null> {
    return null;
  }

  async findByExternalIds(_externalIds: string[]): Promise<Opportunity[]> {
    return [];
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

class FakeSearchIndex implements SearchIndexPort {
  public vectorsByOppId: Map<OpportunityId, number[]> = new Map();
  public retrieveCalls = 0;
  public lastFilters?: CandidateRetrievalFilters;
  public lastLimit?: number;

  constructor(private readonly embedder: HashEmbedder) {}

  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    const [vec] = await this.embedder.embed([`${opportunity.title} ${opportunity.description}`]);
    this.vectorsByOppId.set(opportunity.id, vec);
  }

  async semanticSearch(
    _queryVector: number[],
    _filters: OpportunityFilters,
  ): Promise<OpportunityId[]> {
    return [];
  }

  async similarities(
    profileVector: number[],
    opportunityIds: OpportunityId[],
  ): Promise<Map<OpportunityId, number>> {
    const result = new Map<OpportunityId, number>();
    for (const id of opportunityIds) {
      const vec = this.vectorsByOppId.get(id);
      if (vec) {
        result.set(id, cosine(profileVector, vec));
      }
    }
    return result;
  }

  async retrieveCandidates(
    query: CandidateRetrievalQuery,
    filters: CandidateRetrievalFilters,
    limit: number,
  ): Promise<CandidateRetrievalResult> {
    this.retrieveCalls += 1;
    this.lastFilters = filters;
    this.lastLimit = limit;

    const vectorList: Array<{ id: OpportunityId; cosine: number }> = [];
    for (const [id, vec] of this.vectorsByOppId.entries()) {
      vectorList.push({ id, cosine: cosine(query.vector, vec) });
    }
    vectorList.sort((a, b) => b.cosine - a.cosine);

    const fused = reciprocalRankFusion([vectorList], 60, limit);
    const cosById = new Map(vectorList.map((v) => [v.id, v.cosine]));

    return {
      items: fused.map((f) => ({
        id: f.id,
        cosine: cosById.get(f.id) ?? null,
        textRank: null,
        fusedScore: f.fusedScore,
      })),
      level: 'hybrid',
      degraded: false,
    };
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
  let embedder: HashEmbedder;
  let searchIndex: FakeSearchIndex;
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
    description: 'Servicios de desarrollo de software web',
    contractingEntity: { name: 'Ministerio de TIC', taxId: '800' },
    location: { city: 'Bogotá', department: 'Bogotá D.C.' },
    amount: mustCreateMoney(100_000_000),
    amountKnown: true,
    contractType: 'Servicios',
    procurementModality: 'Licitación',
    isCompetitive: true,
    categoryCode: 'V1.43230000',
    publishedAt: new Date(),
    lastPublishedAt: new Date(),
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
    description: 'Obras civiles estructurales de puente',
    categoryCode: 'V1.72141100',
    amount: mustCreateMoney(900_000_000),
    location: { city: 'Cali', department: 'Valle del Cauca' },
  };

  beforeEach(async () => {
    profileRepo = new FakeProfileRepo();
    oppRepo = new FakeOpportunityRepo();
    recRepo = new FakeRecommendationRepo();
    embedder = new HashEmbedder();
    searchIndex = new FakeSearchIndex(embedder);
    matchingService = new MatchingService();
    useCase = new GetRecommendationsUseCase(
      profileRepo,
      oppRepo,
      recRepo,
      matchingService,
      embedder,
      searchIndex,
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

  it('embeds profile text once, calls retrieveCandidates once for 200 items, scores and ranks descending', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppLow);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppLow);
    await searchIndex.indexOpportunity(oppHigh);
    embedder.calls = 0;

    const result = await useCase.execute({
      profileId: testProfile.id,
    });

    expect(embedder.calls).toBe(1);
    expect(searchIndex.retrieveCalls).toBe(1);
    expect(searchIndex.lastLimit).toBe(CANDIDATE_POOL_SIZE);
    expect(searchIndex.lastLimit).toBe(200);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].opportunityId).toBe('opp-high');
      expect(result.value[1].opportunityId).toBe('opp-low');
      expect(result.value[0].score).toBeGreaterThan(result.value[1].score);
    }

    expect(recRepo.recommendations).toHaveLength(2);
  });

  it('asks for 200 candidates with only onlyCompetitive and actionable as filters', async () => {
    await profileRepo.save(testProfile);

    await useCase.execute({ profileId: testProfile.id });

    expect(searchIndex.lastFilters).toEqual({
      onlyCompetitive: true,
      actionable: true,
    });
    expect(searchIndex.lastLimit).toBe(200);
  });

  it('reuses recommendation id and feedback on repeated calls (no duplicates)', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppHigh);

    recRepo.save = async (rec: Recommendation) => {
      const idx = recRepo.recommendations.findIndex((r) => r.id === rec.id);
      if (idx >= 0) recRepo.recommendations[idx] = rec;
      else recRepo.recommendations.push(rec);
    };

    const first = await useCase.execute({ profileId: testProfile.id });
    if (!first.ok) throw new Error('first call failed');
    recRepo.recommendations[0] = {
      ...recRepo.recommendations[0],
      feedback: { decision: 'Participate', recordedAt: new Date() },
    };

    const second = await useCase.execute({ profileId: testProfile.id });
    if (!second.ok) throw new Error('second call failed');

    expect(recRepo.recommendations).toHaveLength(1);
    expect(second.value[0].id).toBe(first.value[0].id);
    expect(second.value[0].feedback?.decision).toBe('Participate');
  });

  it('returns only the top N recommendations when limit is provided', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppLow);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppLow);
    await searchIndex.indexOpportunity(oppHigh);

    const result = await useCase.execute({ profileId: testProfile.id, limit: 1 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].opportunityId).toBe('opp-high');
    }
  });
});
