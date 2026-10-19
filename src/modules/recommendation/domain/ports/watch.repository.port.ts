import { OpportunityId, ProfileId, UserId } from '../../../shared/domain/typed-id';
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

export interface WatcherProfile {
  readonly profileId: ProfileId;
  readonly alertsEnabled: boolean;
  readonly contactEmail?: string | null;
}

export interface WatchRepositoryPort {
  addWatch(profileId: ProfileId, opportunityId: OpportunityId, userId?: UserId): Promise<void>;
  removeWatch(profileId: ProfileId, opportunityId: OpportunityId, userId?: UserId): Promise<boolean>;
  isWatching(profileId: ProfileId, opportunityId: OpportunityId, userId?: UserId): Promise<boolean>;
  findWatchedPaged(
    profileId: ProfileId,
    page?: number,
    pageSize?: number,
    userId?: UserId,
  ): Promise<PagedWatchedOpportunities>;
  getProfileSummary(profileId: ProfileId, userId?: UserId): Promise<ProfileSummary | null>;
  findWatchers(opportunityId: OpportunityId): Promise<WatcherProfile[]>;
}

export const WATCH_REPOSITORY_PORT = Symbol('WATCH_REPOSITORY_PORT');
