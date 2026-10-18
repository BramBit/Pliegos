import { Result, ok } from '../../../shared/domain/result';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { EmbedderPort } from '../../../recommendation/domain/ports/ai-provider.port';

export const DEFAULT_OPPORTUNITY_SEARCH_LIMIT = 20;

export interface ISearchOpportunitiesUseCase {
  execute(input: {
    query?: string;
    filters?: OpportunityFilters;
  }): Promise<Result<Opportunity[], never>>;
}

export class SearchOpportunitiesUseCase implements ISearchOpportunitiesUseCase {
  constructor(
    private readonly repository: OpportunityRepositoryPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly embedder: EmbedderPort,
  ) {}

  async execute(input: {
    query?: string;
    filters?: OpportunityFilters;
  }): Promise<Result<Opportunity[], never>> {
    const trimmedQuery = input.query?.trim();
    const filters = input.filters ?? {};

    if (trimmedQuery && trimmedQuery.length > 0) {
      const [queryVector] = await this.embedder.embed([trimmedQuery]);
      const retrieved = await this.searchIndex.retrieveCandidates(
        {
          text: trimmedQuery,
          vector: queryVector,
          mode: 'user',
        },
        {
          actionable: filters.actionableOnly,
          department: filters.department,
          categoryCode: filters.categoryCode,
          contractType: filters.contractType,
          amountMin: filters.amountMin,
          amountMax: filters.amountMax,
        },
        filters.limit ?? DEFAULT_OPPORTUNITY_SEARCH_LIMIT,
      );

      const opportunities: Opportunity[] = [];
      for (const item of retrieved.items) {
        const opp = await this.repository.findById(item.id);
        if (opp) {
          opportunities.push(opp);
        }
      }

      return ok(opportunities);
    }

    const filtered = await this.repository.findByFilters(filters);
    return ok(filtered);
  }
}
