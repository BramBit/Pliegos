import { Result, ok, err } from '../../../shared/domain/result';
import {
  RecommendationNotFoundError,
  createRecommendationNotFoundError,
} from '../../../shared/domain/errors';
import { RecommendationId, UserId } from '../../../shared/domain/typed-id';
import { RecommendationRepositoryPort } from '../../domain/ports/recommendation.repository.port';
import { withRecommendationFeedback } from '../../domain/entities/recommendation.entity';
import { FeedbackDecision } from '../../../opportunity/domain/value-objects/opportunity.value-objects';

export interface IRegisterFeedbackUseCase {
  execute(input: {
    recommendationId: RecommendationId;
    decision: FeedbackDecision;
    userId?: UserId;
  }): Promise<Result<void, RecommendationNotFoundError>>;
}

export class RegisterFeedbackUseCase implements IRegisterFeedbackUseCase {
  constructor(
    private readonly recommendationRepository: RecommendationRepositoryPort,
  ) {}

  async execute(input: {
    recommendationId: RecommendationId;
    decision: FeedbackDecision;
    userId?: UserId;
  }): Promise<Result<void, RecommendationNotFoundError>> {
    if (this.recommendationRepository.recordFeedbackWithWatch) {
      const updated =
        await this.recommendationRepository.recordFeedbackWithWatch(
          input.recommendationId,
          input.decision,
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

    const updated = withRecommendationFeedback(recommendation, {
      decision: input.decision,
      recordedAt: new Date(),
    });

    await this.recommendationRepository.save(updated);
    return ok(undefined);
  }
}
