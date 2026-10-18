import { Result, ok } from '../../../shared/domain/result';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import {
  OpportunityFilters,
  PagedOpportunitiesResult,
} from '../../domain/value-objects/opportunity-filters';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { EmbedderPort } from '../../../recommendation/domain/ports/ai-provider.port';

export const DEFAULT_OPPORTUNITY_SEARCH_LIMIT = 20;

export interface ISearchOpportunitiesUseCase {
  execute(input: {
    query?: string;
    filters?: OpportunityFilters;
  }): Promise<Result<Opportunity[], never>>;
  executePaged(input: {
    query?: string;
    q?: string;
    filters?: OpportunityFilters;
  }): Promise<Result<PagedOpportunitiesResult, never>>;
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
    const paged = await this.executePaged({
      query: input.query,
      filters: input.filters,
    });
    if (!paged.ok) {
      return paged;
    }
    return ok(paged.value.items);
  }

  async executePaged(input: {
    query?: string;
    q?: string;
    filters?: OpportunityFilters;
  }): Promise<Result<PagedOpportunitiesResult, never>> {
    const rawQuery = input.q ?? input.query;
    const trimmedQuery = rawQuery?.trim();
    const filters: OpportunityFilters = input.filters ?? {};
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(Math.max(1, Math.trunc(filters.pageSize ?? 20)), 50);

    if (trimmedQuery && trimmedQuery.length > 0) {
      const [queryVector] = await this.embedder.embed([trimmedQuery]);
      const retrieved = await this.searchIndex.retrieveCandidates(
        {
          text: trimmedQuery,
          vector: queryVector,
          mode: 'user',
        },
        {
          onlyCompetitive: filters.onlyCompetitive,
          onlyOpen: filters.onlyOpen,
          actionable: filters.actionableOnly,
          department: filters.department,
          categoryCode: filters.categoryCode,
          contractType: filters.contractType,
          modality: filters.modality,
          status: filters.status,
          closingAfter: filters.closingAfter,
          closingBefore: filters.closingBefore,
          amountMin: filters.amountMin,
          amountMax: filters.amountMax,
        },
        1000,
      );

      const loaded: Opportunity[] = [];
      for (const item of retrieved.items) {
        const opp = await this.repository.findById(item.id);
        if (opp) {
          loaded.push(opp);
        }
      }

      const order = filters.order ?? 'desc';
      const sortField = filters.sort ?? 'relevance';

      if (sortField === 'relevance') {
        if (order === 'asc') {
          loaded.reverse();
        }
      } else if (sortField === 'publishedAt') {
        loaded.sort((a, b) => {
          const timeA = a.publishedAt.getTime();
          const timeB = b.publishedAt.getTime();
          return order === 'asc' ? timeA - timeB : timeB - timeA;
        });
      } else if (sortField === 'closingDate') {
        loaded.sort((a, b) => {
          if (!a.closingDate && !b.closingDate) return 0;
          if (!a.closingDate) return 1;
          if (!b.closingDate) return -1;
          const timeA = a.closingDate.getTime();
          const timeB = b.closingDate.getTime();
          return order === 'asc' ? timeA - timeB : timeB - timeA;
        });
      } else if (sortField === 'amount') {
        loaded.sort((a, b) => {
          const amtA = a.amount?.amount ?? null;
          const amtB = b.amount?.amount ?? null;
          if (amtA === null && amtB === null) return 0;
          if (amtA === null) return 1;
          if (amtB === null) return -1;
          return order === 'asc' ? amtA - amtB : amtB - amtA;
        });
      }

      const total = loaded.length;
      const offset = (page - 1) * pageSize;
      const items = loaded.slice(offset, offset + pageSize);

      return ok({
        items,
        total,
        page,
        pageSize,
      });
    }

    if (this.repository.findPaged) {
      const paged = await this.repository.findPaged({
        ...filters,
        page,
        pageSize,
      });
      return ok(paged);
    }

    const all = await this.repository.findByFilters({
      ...filters,
      page,
      pageSize: 1000,
    });
    const total = all.length;
    const offset = (page - 1) * pageSize;
    const items = all.slice(offset, offset + pageSize);

    return ok({
      items,
      total,
      page,
      pageSize,
    });
  }
}
