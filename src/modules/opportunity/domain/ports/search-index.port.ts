import { Opportunity } from '../entities/opportunity.entity';
import { OpportunityId } from '../../../shared/domain/typed-id';
import { OpportunityFilters } from '../value-objects/opportunity-filters';

export interface SearchIndexPort {
  indexOpportunity(opportunity: Opportunity): Promise<void>;
  semanticSearch(queryVector: number[], filters: OpportunityFilters): Promise<OpportunityId[]>;
}

export const SEARCH_INDEX_PORT = Symbol('SEARCH_INDEX_PORT');
