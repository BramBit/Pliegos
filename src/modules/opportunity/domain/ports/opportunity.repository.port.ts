import { Opportunity } from '../entities/opportunity.entity';
import { OpportunityId } from '../../../shared/domain/typed-id';
import { OpportunityFilters } from '../value-objects/opportunity-filters';
import { Analysis } from '../value-objects/opportunity.value-objects';

export interface SyncState {
  readonly source: string;
  readonly lastSuccessAt: Date | null;
  readonly watermark: Date | null;
}

export interface OpportunityRepositoryPort {
  save(opportunity: Opportunity): Promise<void>;
  saveMany(opportunities: Opportunity[]): Promise<void>;
  saveAnalysis(id: OpportunityId, analysis: Analysis): Promise<void>;
  withAnalysisLock?(id: OpportunityId, work: () => Promise<void>): Promise<void>;
  findById(id: OpportunityId): Promise<Opportunity | null>;
  findByExternalId(externalId: string): Promise<Opportunity | null>;
  findByExternalIds(externalIds: string[]): Promise<Opportunity[]>;
  findByFilters(filters: OpportunityFilters): Promise<Opportunity[]>;
  getSyncState?(source: string): Promise<SyncState | null>;
  saveSyncState?(
    source: string,
    state: { lastSuccessAt: Date; watermark: Date | null },
  ): Promise<void>;
}

export const OPPORTUNITY_REPOSITORY_PORT = Symbol('OPPORTUNITY_REPOSITORY_PORT');
