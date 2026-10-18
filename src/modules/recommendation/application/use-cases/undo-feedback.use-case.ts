import { Result, ok, err } from '../../../shared/domain/result';
import {
  RecommendationNotFoundError,
  createRecommendationNotFoundError,
} from '../../../shared/domain/errors';
import { RecommendationId, UserId } from '../../../shared/domain/typed-id';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';

export interface IUndoFeedbackUseCase {
  execute(input: {
    recommendationId: RecommendationId;
    userId?: UserId;
  }): Promise<Result<void, RecommendationNotFoundError>>;
}

export class UndoFeedbackUseCase implements IUndoFeedbackUseCase {
  constructor(
    private readonly recommendationRepository: RecommendationRepositoryPort,
  ) {}

  async execute(input: {
    recommendationId: RecommendationId;
    userId?: UserId;
  }): Promise<Result<void, RecommendationNotFoundError>> {
    if (this.recommendationRepository.clearFeedbackWithWatch) {
      const updated = await this.recommendationRepository.clearFeedbackWithWatch(
        input.recommendationId,
        input.userId,
      );
      if (!updated) {
        return err(createRecommendationNotFoundError(input.recommendationId));
      }
      return ok(undefined);
    }

    const recommendation = await this.recommendationRepository.findById(
      input.recommendationId,
      input.userId,
    );

    if (!recommendation) {
      return err(createRecommendationNotFoundError(input.recommendationId));
    }

    const updated = {
      ...recommendation,
      feedback: null,
    };

    await this.recommendationRepository.save(updated);
    return ok(undefined);
  }
}
