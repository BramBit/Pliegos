import { OpportunityStatus } from './opportunity.value-objects';

export type OpportunitySortField = 'publishedAt' | 'closingDate' | 'amount' | 'relevance';
export type SortOrder = 'asc' | 'desc';

export interface OpportunityFilters {
  readonly categoryCode?: string;
  readonly department?: string;
  readonly contractType?: string;
  readonly modality?: string;
  readonly status?: OpportunityStatus;
  readonly closingAfter?: Date;
  readonly closingBefore?: Date;
  readonly amountMin?: number;
  readonly amountMax?: number;
  readonly onlyCompetitive?: boolean;
  readonly onlyOpen?: boolean;
  /** Only processes still open to bidders: status Published/Amended and not past closing date. */
  readonly actionableOnly?: boolean;
  readonly sort?: OpportunitySortField;
  readonly order?: SortOrder;
  readonly page?: number;
  readonly pageSize?: number;
  /** Max rows returned (default 100, capped at 1000). */
  readonly limit?: number;
}

export interface PagedOpportunitiesResult {
  readonly items: import('../entities/opportunity.entity').Opportunity[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}
