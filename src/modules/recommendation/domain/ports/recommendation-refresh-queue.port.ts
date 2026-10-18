import { ProfileId } from '../../../shared/domain/typed-id';

export interface RecommendationRefreshQueuePort {
  enqueueRefresh(profileId: ProfileId): Promise<void>;
  enqueueRefreshForAllProfiles?(): Promise<number>;
}

export const RECOMMENDATION_REFRESH_QUEUE_PORT = Symbol('RECOMMENDATION_REFRESH_QUEUE_PORT');
