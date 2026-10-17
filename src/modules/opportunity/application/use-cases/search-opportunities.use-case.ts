import { Result, ok } from '../../../shared/domain/result';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../domain/value-objects/opportunity-filters';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { EmbedderPort } from '../../../recommendation/domain/ports/ai-provider.port';

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

    if (trimmedQuery && trimmedQuery.length > 0) {
      const [queryVector] = await this.embedder.embed([trimmedQuery]);
      const matchedIds = await this.searchIndex.semanticSearch(
        queryVector,
        input.filters ?? {},
      );

      const opportunities: Opportunity[] = [];
      for (const id of matchedIds) {
        const opp = await this.repository.findById(id);
        if (opp) {
          opportunities.push(opp);
        }
      }

      return ok(opportunities);
    }

    const filtered = await this.repository.findByFilters(input.filters ?? {});
    return ok(filtered);
  }
}
