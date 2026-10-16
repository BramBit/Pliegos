export interface OpportunityFilters {
  readonly categoryCode?: string;
  readonly department?: string;
  readonly contractType?: string;
  readonly amountMin?: number;
  readonly amountMax?: number;
  /** Only processes still open to bidders: status Published/Amended and not past closing date. */
  readonly actionableOnly?: boolean;
  /** Max rows returned (default 100, capped at 1000). */
  readonly limit?: number;
}
