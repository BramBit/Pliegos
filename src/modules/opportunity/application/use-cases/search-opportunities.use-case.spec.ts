import { SearchOpportunitiesUseCase } from './search-opportunities.use-case';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { AIProviderPort } from '../../../recommendation/domain/ports/ai-provider.port';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityId, asOpportunityId } from '../../../shared/domain/typed-id';
import { createMoney } from '../../domain/value-objects/money.vo';

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
  public lastVector: number[] = [];
  public lastFilters: OpportunityFilters = {};

  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    this.indexed.push(opportunity);
  }

  async semanticSearch(
    queryVector: number[],
    filters: OpportunityFilters,
  ): Promise<OpportunityId[]> {
    this.lastVector = queryVector;
    this.lastFilters = filters;
    return this.returnIds;
  }
}

class FakeAI implements AIProviderPort {
  async embed(text: string): Promise<number[]> {
    // Generate dummy 768-dim vector
    return new Array(768).fill(text.length);
  }

  async scoreSimilarity(_textA: string, _textB: string): Promise<number> {
    return 1.0;
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

describe('SearchOpportunitiesUseCase', () => {
  let repo: FakeRepo;
  let searchIndex: FakeSearchIndex;
  let ai: FakeAI;
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
    ai = new FakeAI();
    useCase = new SearchOpportunitiesUseCase(repo, searchIndex, ai);
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
    expect(searchIndex.lastVector).toHaveLength(0);
  });

  it('performs semantic search when query is provided, returning ranked opportunities', async () => {
    // Arrange semantic ranking order: opp2 before opp1
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

    expect(searchIndex.lastVector).toHaveLength(768);
  });

  it('passes structured filters alongside semantic query vector', async () => {
    searchIndex.returnIds = [asOpportunityId('opp-1')];

    const filters: OpportunityFilters = { categoryCode: 'V1.43230000' };
    const result = await useCase.execute({
      query: 'software',
      filters,
    });

    expect(result.ok).toBe(true);
    expect(searchIndex.lastFilters).toEqual(filters);
  });
});
