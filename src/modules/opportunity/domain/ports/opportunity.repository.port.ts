import { Opportunity } from '../entities/opportunity.entity';
import { OpportunityId } from '../../../shared/domain/typed-id';
import { OpportunityFilters } from '../value-objects/opportunity-filters';

export interface OpportunityRepositoryPort {
  save(opportunity: Opportunity): Promise<void>;
  findById(id: OpportunityId): Promise<Opportunity | null>;
  findByExternalId(externalId: string): Promise<Opportunity | null>;
  findByFilters(filters: OpportunityFilters): Promise<Opportunity[]>;
}

export const OPPORTUNITY_REPOSITORY_PORT = Symbol('OPPORTUNITY_REPOSITORY_PORT');
