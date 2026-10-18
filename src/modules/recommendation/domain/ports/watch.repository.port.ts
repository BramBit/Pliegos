import { OpportunityId, ProfileId } from '../../../shared/domain/typed-id';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';
import { Change } from '../../../opportunity/domain/value-objects/opportunity.value-objects';

export interface WatchedOpportunityItem {
  readonly opportunity: Opportunity;
  readonly last10Changes: Change[];
  readonly addedAt: Date;
}

export interface PagedWatchedOpportunities {
  readonly items: WatchedOpportunityItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ProfileSummary {
  readonly newRecommendations: number;
  readonly watching: number;
  readonly closingSoon: number;
  readonly unreadAlerts: number;
}

export interface WatchRepositoryPort {
  addWatch(profileId: ProfileId, opportunityId: OpportunityId): Promise<void>;
  removeWatch(profileId: ProfileId, opportunityId: OpportunityId): Promise<boolean>;
  isWatching(profileId: ProfileId, opportunityId: OpportunityId): Promise<boolean>;
  findWatchedPaged(
    profileId: ProfileId,
    page?: number,
    pageSize?: number,
  ): Promise<PagedWatchedOpportunities>;
  getProfileSummary(profileId: ProfileId): Promise<ProfileSummary | null>;
}

export const WATCH_REPOSITORY_PORT = Symbol('WATCH_REPOSITORY_PORT');
