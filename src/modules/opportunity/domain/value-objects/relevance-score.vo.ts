import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';

export type RelevanceScore = number & { readonly __brand: 'RelevanceScore' };

export const createRelevanceScore = (score: number): Result<RelevanceScore, ValidationError> => {
  if (typeof score !== 'number' || !Number.isFinite(score) || isNaN(score)) {
    return err(
      createValidationError(['score'], `RelevanceScore must be a valid finite number, got: ${score}`),
    );
  }

  if (score < 0 || score > 1) {
    return err(
      createValidationError(['score'], `RelevanceScore must be between 0 and 1 inclusive, got: ${score}`),
    );
  }

  return ok(score as RelevanceScore);
};
