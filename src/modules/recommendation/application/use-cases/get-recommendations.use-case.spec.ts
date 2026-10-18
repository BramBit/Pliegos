import { GetRecommendationsUseCase } from './get-recommendations.use-case';
import {
  RefreshRecommendationsUseCase,
  REFRESH_CANDIDATE_POOL_SIZE,
} from './refresh-recommendations.use-case';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import {
  SearchIndexPort,
  CandidateRetrievalQuery,
  CandidateRetrievalFilters,
  CandidateRetrievalResult,
  reciprocalRankFusion,
} from '../../../opportunity/domain/ports/search-index.port';
import {
  RecommendationRepositoryPort,
  ProfileEmbeddingRecord,
  RecommendationRun,
} from '../../domain/ports/recommendation.repository.port';
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
  asRecommendationId,
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
  public profileEmbeddings: Map<ProfileId, ProfileEmbeddingRecord> = new Map();
  public runs: RecommendationRun[] = [];

  async save(recommendation: Recommendation): Promise<void> {
    const idx = this.recommendations.findIndex((r) => r.id === recommendation.id);
    if (idx >= 0) {
      this.recommendations[idx] = recommendation;
    } else {
      this.recommendations.push(recommendation);
    }
  }

  async upsertMany(
    profileId: ProfileId,
    incoming: Recommendation[],
  ): Promise<Recommendation[]> {
    const keptOppIds = new Set<OpportunityId>();
    const kept: Recommendation[] = [];

    for (const rec of incoming) {
      keptOppIds.add(rec.opportunityId);
      const existingIdx = this.recommendations.findIndex(
        (r) => r.profileId === profileId && r.opportunityId === rec.opportunityId,
      );
      if (existingIdx >= 0) {
        const prev = this.recommendations[existingIdx];
        const merged: Recommendation = {
          ...rec,
          id: prev.id,
          feedback: prev.feedback ?? rec.feedback,
        };
        this.recommendations[existingIdx] = merged;
        kept.push(merged);
      } else {
        this.recommendations.push(rec);
        kept.push(rec);
      }
    }

    // Delete stale rows outside top set that have no feedback
    this.recommendations = this.recommendations.filter(
      (r) =>
        r.profileId !== profileId ||
        keptOppIds.has(r.opportunityId) ||
        r.feedback !== null,
    );

    return kept;
  }

  async findByProfile(profileId: ProfileId): Promise<Recommendation[]> {
    return this.recommendations
      .filter((r) => r.profileId === profileId)
      .sort((a, b) => b.score - a.score);
  }

  async findById(id: RecommendationId): Promise<Recommendation | null> {
    return this.recommendations.find((r) => r.id === id) ?? null;
  }

  async getProfileEmbedding(profileId: ProfileId): Promise<ProfileEmbeddingRecord | null> {
    return this.profileEmbeddings.get(profileId) ?? null;
  }

  async saveProfileEmbedding(record: ProfileEmbeddingRecord): Promise<void> {
    this.profileEmbeddings.set(record.profileId, record);
  }

  async recordRun(run: RecommendationRun): Promise<void> {
    this.runs.push(run);
  }

  async getLatestRun(profileId: ProfileId): Promise<RecommendationRun | null> {
    const forProfile = this.runs.filter((r) => r.profileId === profileId);
    if (forProfile.length === 0) return null;
    return forProfile[forProfile.length - 1];
  }
}

class FakeSearchIndex implements SearchIndexPort {
  public vectorsByOppId: Map<OpportunityId, number[]> = new Map();
  public retrieveCalls = 0;
  public lastFilters?: CandidateRetrievalFilters;
  public lastLimit?: number;
  public forceDegraded = false;

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
      level: this.forceDegraded ? 'fulltext' : 'hybrid',
      degraded: this.forceDegraded,
    };
  }
}

const mustCreateMoney = (amount: number) => {
  const result = createMoney(amount);
  if (!result.ok) throw new Error(`Money failed for ${amount}`);
  return result.value;
};

describe('RefreshRecommendationsUseCase & GetRecommendationsUseCase (P2.6)', () => {
  let profileRepo: FakeProfileRepo;
  let oppRepo: FakeOpportunityRepo;
  let recRepo: FakeRecommendationRepo;
  let embedder: HashEmbedder;
  let searchIndex: FakeSearchIndex;
  let matchingService: MatchingService;
  let refreshUseCase: RefreshRecommendationsUseCase;
  let getUseCase: GetRecommendationsUseCase;

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
    refreshUseCase = new RefreshRecommendationsUseCase(
      profileRepo,
      oppRepo,
      recRepo,
      matchingService,
      embedder,
      searchIndex,
    );
    getUseCase = new GetRecommendationsUseCase(profileRepo, recRepo);
  });

  it('returns ProfileNotFoundError when profile is not registered', async () => {
    const refreshRes = await refreshUseCase.execute({
      profileId: asProfileId('non-existent'),
    });
    expect(refreshRes.ok).toBe(false);

    const getRes = await getUseCase.execute({
      profileId: asProfileId('non-existent'),
    });
    expect(getRes.ok).toBe(false);
    if (!getRes.ok) {
      expect(getRes.error.type).toBe('ProfileNotFoundError');
      expect(getRes.error.profileId).toBe('non-existent');
    }
  });

  it('the read path (GetRecommendationsUseCase) makes zero Ollama calls (embedder.calls == 0) and returns lastRefreshedAt and degraded', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppHigh);

    searchIndex.forceDegraded = true;
    await refreshUseCase.execute({ profileId: testProfile.id });

    // Reset embedder and searchIndex counters before calling the read path
    embedder.calls = 0;
    searchIndex.retrieveCalls = 0;

    const readResult = await getUseCase.execute({ profileId: testProfile.id });

    expect(embedder.calls).toBe(0);
    expect(searchIndex.retrieveCalls).toBe(0);
    expect(readResult.ok).toBe(true);
    if (readResult.ok) {
      expect(readResult.value.items).toHaveLength(1);
      expect(readResult.value[0].opportunityId).toBe('opp-high');
      expect(readResult.value.lastRefreshedAt).toBeInstanceOf(Date);
      expect(readResult.value.degraded).toBe(true);
    }
  });

  it('refreshing twice keeps the same ids and the feedback, reuses profile_embeddings (0 embed calls on 2nd run), and creates no duplicates', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppHigh);
    embedder.calls = 0;

    const first = await refreshUseCase.execute({ profileId: testProfile.id });
    if (!first.ok) throw new Error('first refresh failed');
    expect(embedder.calls).toBe(1);
    expect(searchIndex.lastLimit).toBe(REFRESH_CANDIDATE_POOL_SIZE);
    expect(searchIndex.lastFilters).toEqual({
      onlyCompetitive: true,
      actionable: true,
    });

    const firstId = first.value.recommendations[0].id;

    // Attach feedback on the persisted recommendation
    recRepo.recommendations[0] = {
      ...recRepo.recommendations[0],
      feedback: { decision: 'Participate', recordedAt: new Date() },
    };

    embedder.calls = 0;
    const second = await refreshUseCase.execute({ profileId: testProfile.id });
    if (!second.ok) throw new Error('second refresh failed');

    // Profile query text and model did not change -> reused profile_embeddings!
    expect(embedder.calls).toBe(0);
    expect(recRepo.recommendations).toHaveLength(1);
    expect(second.value.recommendations[0].id).toBe(firstId);
    expect(second.value.recommendations[0].feedback?.decision).toBe('Participate');
    expect(recRepo.runs).toHaveLength(2);
  });

  it('deletes stale recommendations outside the top 50 that have no feedback, while keeping rows with feedback', async () => {
    await profileRepo.save(testProfile);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppHigh);

    // Seed two stale recommendations: one without feedback, one with feedback
    recRepo.recommendations.push({
      id: asRecommendationId('rec-stale-no-fb'),
      profileId: testProfile.id,
      opportunityId: asOpportunityId('opp-stale-1'),
      score: 0.5,
      explanation: { summary: 'Stale', matchedFactors: [] },
      feedback: null,
    });
    recRepo.recommendations.push({
      id: asRecommendationId('rec-stale-with-fb'),
      profileId: testProfile.id,
      opportunityId: asOpportunityId('opp-stale-2'),
      score: 0.5,
      explanation: { summary: 'Stale with feedback', matchedFactors: [] },
      feedback: { decision: 'Discard', recordedAt: new Date() },
    });

    await refreshUseCase.execute({ profileId: testProfile.id });

    const remainingOppIds = recRepo.recommendations.map((r) => r.opportunityId);
    expect(remainingOppIds).toContain('opp-high');
    expect(remainingOppIds).toContain('opp-stale-2'); // kept because it has feedback
    expect(remainingOppIds).not.toContain('opp-stale-1'); // deleted because no feedback
  });

  it('filters out candidates below MIN_RECOMMENDATION_SCORE (0.45) and slices read results by limit', async () => {
    const oppMedium: Opportunity = {
      ...oppHigh,
      id: asOpportunityId('opp-medium'),
      categoryCode: 'V1.43231500',
    };
    await profileRepo.save(testProfile);
    await oppRepo.save(oppLow);
    await oppRepo.save(oppMedium);
    await oppRepo.save(oppHigh);
    await searchIndex.indexOpportunity(oppLow);
    await searchIndex.indexOpportunity(oppMedium);
    await searchIndex.indexOpportunity(oppHigh);

    await refreshUseCase.execute({ profileId: testProfile.id });

    // oppLow (< 0.45) is not persisted
    expect(recRepo.recommendations).toHaveLength(2);

    const limited = await getUseCase.execute({ profileId: testProfile.id, limit: 1 });
    expect(limited.ok).toBe(true);
    if (limited.ok) {
      expect(limited.value).toHaveLength(1);
      expect(limited.value[0].opportunityId).toBe('opp-high');
    }
  });
});
