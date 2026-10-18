import {
  RecommendationId,
  ProfileId,
  OpportunityId,
} from '../../../shared/domain/typed-id';
import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';
import {
  Explanation,
  Feedback,
} from '../../../opportunity/domain/value-objects/opportunity.value-objects';

export type { Explanation, Feedback };

export interface Recommendation {
  readonly id: RecommendationId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly score: number; // 0..1
  readonly explanation: Explanation;
  readonly feedback: Feedback | null;
}

export interface CreateRecommendationProps {
  readonly id: RecommendationId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly score: number;
  readonly explanation: Explanation;
  readonly feedback?: Feedback | null;
}

export const createRecommendation = (
  props: CreateRecommendationProps,
): Result<Recommendation, ValidationError> => {
  const missingFields: string[] = [];

  if (!props.id || props.id.trim() === '') {
    missingFields.push('id');
  }
  if (!props.profileId || props.profileId.trim() === '') {
    missingFields.push('profileId');
  }
  if (!props.opportunityId || props.opportunityId.trim() === '') {
    missingFields.push('opportunityId');
  }
  if (
    typeof props.score !== 'number' ||
    !Number.isFinite(props.score) ||
    props.score < 0 ||
    props.score > 1
  ) {
    missingFields.push('score');
  }
  if (!props.explanation || !props.explanation.summary) {
    missingFields.push('explanation');
  }

  if (missingFields.length > 0) {
    return err(
      createValidationError(
        missingFields,
        `Cannot create Recommendation: invalid or missing fields: ${missingFields.join(', ')}`,
      ),
    );
  }

  return ok({
    id: props.id,
    profileId: props.profileId,
    opportunityId: props.opportunityId,
    score: props.score,
    explanation: props.explanation,
    feedback: props.feedback ?? null,
  });
};

export const withRecommendationFeedback = (
  recommendation: Recommendation,
  feedback: Feedback,
): Recommendation => ({
  ...recommendation,
  feedback,
});
