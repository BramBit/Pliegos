import { OpportunityId, ProfileId, RecommendationId } from './typed-id';

export interface SourceUnavailableError {
  readonly type: 'SourceUnavailableError';
  readonly sourceName: string;
}

export interface OpportunityNotFoundError {
  readonly type: 'OpportunityNotFoundError';
  readonly opportunityId: OpportunityId;
}

export interface ProfileNotFoundError {
  readonly type: 'ProfileNotFoundError';
  readonly profileId: ProfileId;
}

export interface RecommendationNotFoundError {
  readonly type: 'RecommendationNotFoundError';
  readonly recommendationId: RecommendationId;
}

export interface ValidationError {
  readonly type: 'ValidationError';
  readonly fields: string[];
  readonly message?: string;
}

export const createSourceUnavailableError = (sourceName: string): SourceUnavailableError => ({
  type: 'SourceUnavailableError',
  sourceName,
});

export const createOpportunityNotFoundError = (
  opportunityId: OpportunityId,
): OpportunityNotFoundError => ({
  type: 'OpportunityNotFoundError',
  opportunityId,
});

export const createProfileNotFoundError = (profileId: ProfileId): ProfileNotFoundError => ({
  type: 'ProfileNotFoundError',
  profileId,
});

export const createRecommendationNotFoundError = (
  recommendationId: RecommendationId,
): RecommendationNotFoundError => ({
  type: 'RecommendationNotFoundError',
  recommendationId,
});

export const createValidationError = (fields: string[], message?: string): ValidationError => ({
  type: 'ValidationError',
  fields,
  message,
});
