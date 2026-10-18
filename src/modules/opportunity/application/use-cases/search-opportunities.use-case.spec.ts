import { SearchOpportunitiesUseCase } from './search-opportunities.use-case';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import {
  SearchIndexPort,
  CandidateRetrievalQuery,
  CandidateRetrievalFilters,
  CandidateRetrievalResult,
} from '../../domain/ports/search-index.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityId, asOpportunityId } from '../../../shared/domain/typed-id';
import { createMoney } from '../../domain/value-objects/money.vo';
import { HashEmbedder } from '../../../shared/testing/hash-embedder';

class FakeRepo implements OpportunityRepositoryPort {
  public data: Map<string, Opportunity> = new Map();

  async save(opportunity: Opportunity): Promise<void> {
    this.data.set(opportunity.id, opportunity);
  }

  async saveMany(opportunities: Opportunity[]): Promise<void> {
    for (const opp of opportunities) {
      this.data.set(opp.id, opp);
    }
  }

  async saveAnalysis(id: OpportunityId, analysis: Opportunity['analysis']): Promise<void> {
    const existing = this.data.get(id);
    if (existing) {
      this.data.set(id, { ...existing, analysis });
    }
  }

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    return this.data.get(id) ?? null;
  }

  async findByExternalId(_externalId: string): Promise<Opportunity | null> {
    return null;
  }

  async findByExternalIds(_externalIds: string[]): Promise<Opportunity[]> {
    return [];
  }

  async findByFilters(filters: OpportunityFilters): Promise<Opportunity[]> {
    let result = Array.from(this.data.values());
    if (filters.categoryCode) {
      result = result.filter((o) => o.categoryCode === filters.categoryCode);
    }
    if (filters.department) {
      result = result.filter((o) => o.location.department === filters.department);
    }
    return result;
  }
}

class FakeSearchIndex implements SearchIndexPort {
  public indexed: Opportunity[] = [];
  public returnIds: OpportunityId[] = [];
  public lastQuery?: CandidateRetrievalQuery;
  public lastFilters: CandidateRetrievalFilters = {};
  public lastLimit = 0;

  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    this.indexed.push(opportunity);
  }

  async semanticSearch(
    _queryVector: number[],
    _filters: OpportunityFilters,
  ): Promise<OpportunityId[]> {
    return this.returnIds;
  }

  async similarities(
    _profileVector: number[],
    _opportunityIds: OpportunityId[],
  ): Promise<Map<OpportunityId, number>> {
    return new Map();
  }

  async retrieveCandidates(
    query: CandidateRetrievalQuery,
    filters: CandidateRetrievalFilters,
    limit: number,
  ): Promise<CandidateRetrievalResult> {
    this.lastQuery = query;
    this.lastFilters = filters;
    this.lastLimit = limit;

    return {
      items: this.returnIds.map((id, i) => ({
        id,
        cosine: 0.7,
        textRank: 0.5,
        fusedScore: 1 / (60 + i + 1),
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

describe('SearchOpportunitiesUseCase', () => {
  let repo: FakeRepo;
  let searchIndex: FakeSearchIndex;
  let embedder: HashEmbedder;
  let useCase: SearchOpportunitiesUseCase;

  const opp1: Opportunity = {
    id: asOpportunityId('opp-1'),
    title: 'Servicios de desarrollo de software',
    description: 'Desarrollo de aplicaciones web',
    contractingEntity: { name: 'DNP', taxId: '800111222' },
    location: { city: 'Bogotá', department: 'Bogotá D.C.' },
    amount: mustCreateMoney(80_000_000),
    amountKnown: true,
    contractType: 'Servicios',
    procurementModality: 'Concurso de méritos',
    isCompetitive: true,
    categoryCode: 'V1.43230000',
    publishedAt: new Date('2026-10-01'),
    lastPublishedAt: new Date('2026-10-01'),
    closingDate: new Date('2026-10-25'),
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: '101',
      humanReference: 'DNP-01',
      originalUrl: 'https://secop.gov.co/101',
    },
    analysis: null,
    changeHistory: [],
  };

  const opp2: Opportunity = {
    ...opp1,
    id: asOpportunityId('opp-2'),
    title: 'Adquisición de computadores portátiles',
    categoryCode: 'V1.43211500',
    location: { city: 'Medellín', department: 'Antioquia' },
  };

  beforeEach(() => {
    repo = new FakeRepo();
    repo.save(opp1);
    repo.save(opp2);
    searchIndex = new FakeSearchIndex();
    embedder = new HashEmbedder();
    useCase = new SearchOpportunitiesUseCase(repo, searchIndex, embedder);
  });

  it('performs structured filter search when no semantic query is provided', async () => {
    const result = await useCase.execute({
      filters: { department: 'Bogotá D.C.' },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].id).toBe('opp-1');
    }
    expect(searchIndex.lastQuery).toBeUndefined();
    expect(embedder.calls).toBe(0);
  });

  it('performs hybrid candidate retrieval when query is provided, returning ranked opportunities', async () => {
    searchIndex.returnIds = [asOpportunityId('opp-2'), asOpportunityId('opp-1')];

    const result = await useCase.execute({
      query: 'laptops y hardware para oficina',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].id).toBe('opp-2');
      expect(result.value[1].id).toBe('opp-1');
    }

    expect(searchIndex.lastQuery?.text).toBe('laptops y hardware para oficina');
    expect(searchIndex.lastQuery?.mode).toBe('user');
    expect(searchIndex.lastQuery?.vector).toHaveLength(768);
  });

  it('passes structured filters alongside hybrid query', async () => {
    searchIndex.returnIds = [asOpportunityId('opp-1')];

    const filters: OpportunityFilters = { categoryCode: 'V1.43230000' };
    const result = await useCase.execute({
      query: 'software',
      filters,
    });

    expect(result.ok).toBe(true);
    expect(searchIndex.lastFilters).toEqual(
      expect.objectContaining({ categoryCode: 'V1.43230000' }),
    );
  });
});
