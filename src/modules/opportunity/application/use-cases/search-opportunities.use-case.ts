import { Result, ok } from '../../../shared/domain/result';
import { Opportunity } from '../../domain/entities/opportunity.entity';
import {
  OpportunityFilters,
  PagedOpportunitiesResult,
} from '../../domain/value-objects/opportunity-filters';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { SearchIndexPort } from '../../domain/ports/search-index.port';
import { EmbedderPort } from '../../../recommendation/domain/ports/ai-provider.port';
import {
  evaluateCriteria,
  Criteria,
} from '../../domain/services/criteria-evaluator';

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
    const pageSize = Math.min(
      Math.max(1, Math.trunc(filters.pageSize ?? 20)),
      50,
    );

    if (trimmedQuery && trimmedQuery.length > 0) {
      const [queryVector] = await this.embedder.embed([trimmedQuery]);
      const retrieved = await this.searchIndex.retrieveCandidates(
        {
          text: trimmedQuery,
          vector: queryVector,
          mode: 'user',
        },
        {
          hardExclusionsOnly: true,
        },
        300,
      );

      const loaded: Opportunity[] = [];
      for (const item of retrieved.items) {
        const opp = await this.repository.findById(item.id);
        if (opp) {
          loaded.push(opp);
        }
      }

      const criteria: Criteria = {
        amountMin: filters.amountMin,
        amountMax: filters.amountMax,
        departments:
          filters.departments ??
          (filters.department ? [filters.department] : undefined),
        categoryPrefixes:
          filters.categoryPrefixes ??
          (filters.categoryPrefix
            ? [filters.categoryPrefix]
            : filters.categoryCode
              ? [filters.categoryCode]
              : undefined),
        closingAfter: filters.closingAfter,
        closingBefore: filters.closingBefore,
      };

      const evaluated: Opportunity[] = loaded.map((opp) => {
        const evalResult = evaluateCriteria(opp, criteria);
        const statusConfidence: 'confirmed' | 'unconfirmed' =
          opp.status === 'Unknown' ? 'unconfirmed' : 'confirmed';
        return {
          ...opp,
          matchTier: evalResult.tier,
          missingCriteria: evalResult.missing,
          statusConfidence,
        };
      });

      const tier1Count = evaluated.filter((o) => o.matchTier === 1).length;
      const tier2Count = evaluated.filter((o) => o.matchTier === 2).length;
      const tier3Count = evaluated.filter((o) => o.matchTier === 3).length;

      const filteredCandidates = filters.includeMismatches
        ? evaluated
        : evaluated.filter((o) => o.matchTier !== 3);

      const order = filters.order ?? 'desc';
      const sortField = filters.sort ?? 'relevance';
      const initialIndex = new Map(
        filteredCandidates.map((opp, idx) => [opp.id, idx]),
      );

      filteredCandidates.sort((a, b) => {
        const tierA = a.matchTier ?? 1;
        const tierB = b.matchTier ?? 1;
        if (tierA !== tierB) {
          return tierA - tierB;
        }

        if (sortField === 'relevance') {
          const idxA = initialIndex.get(a.id) ?? 0;
          const idxB = initialIndex.get(b.id) ?? 0;
          return order === 'asc' ? idxB - idxA : idxA - idxB;
        } else if (sortField === 'publishedAt') {
          const timeA = a.publishedAt.getTime();
          const timeB = b.publishedAt.getTime();
          return order === 'asc' ? timeA - timeB : timeB - timeA;
        } else if (sortField === 'closingDate') {
          if (!a.closingDate && !b.closingDate) return 0;
          if (!a.closingDate) return 1;
          if (!b.closingDate) return -1;
          const timeA = a.closingDate.getTime();
          const timeB = b.closingDate.getTime();
          return order === 'asc' ? timeA - timeB : timeB - timeA;
        } else if (sortField === 'amount') {
          const amtA = a.amount?.amount ?? null;
          const amtB = b.amount?.amount ?? null;
          if (amtA === null && amtB === null) return 0;
          if (amtA === null) return 1;
          if (amtB === null) return -1;
          return order === 'asc' ? amtA - amtB : amtB - amtA;
        }
        return 0;
      });

      const total = filteredCandidates.length;
      const offset = (page - 1) * pageSize;
      const items = filteredCandidates.slice(offset, offset + pageSize);

      return ok({
        items,
        total,
        page,
        pageSize,
        tierCounts: {
          1: tier1Count,
          2: tier2Count,
          3: filters.includeMismatches ? tier3Count : 0,
        },
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
