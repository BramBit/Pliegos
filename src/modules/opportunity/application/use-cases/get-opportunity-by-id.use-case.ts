import { Result, ok, err } from '../../../shared/domain/result';
import {
  OpportunityNotFoundError,
  createOpportunityNotFoundError,
} from '../../../shared/domain/errors';
import { OpportunityId } from '../../../shared/domain/typed-id';
import { OpportunityRepositoryPort } from '../../domain/ports/opportunity.repository.port';
import { AnalysisQueuePort } from '../../domain/ports/analysis-queue.port';
import {
  Opportunity,
  withOpportunityAnalysis,
} from '../../domain/entities/opportunity.entity';
import {
  Analysis,
  SummaryStatus,
} from '../../domain/value-objects/opportunity.value-objects';
import { hasGeneratedSummary } from '../../infrastructure/jobs/analyze-opportunity.job';

export interface GetOpportunityByIdOutput {
  readonly opportunity: Opportunity;
  readonly summaryStatus: SummaryStatus;
}

export class GetOpportunityByIdUseCase {
  constructor(
    private readonly opportunityRepository: OpportunityRepositoryPort,
    private readonly analysisQueue?: AnalysisQueuePort,
  ) {}

  async execute(input: {
    opportunityId: OpportunityId;
  }): Promise<Result<GetOpportunityByIdOutput, OpportunityNotFoundError>> {
    const opportunity = await this.opportunityRepository.findById(input.opportunityId);
    if (!opportunity) {
      return err(createOpportunityNotFoundError(input.opportunityId));
    }

    if (hasGeneratedSummary(opportunity.analysis)) {
      const summaryStatus: SummaryStatus =
        opportunity.analysis?.summaryStatus ?? 'ready';
      const normalizedAnalysis: Analysis = {
        summary: opportunity.analysis?.summary ?? '',
        summaryStatus,
        requirements: opportunity.analysis?.requirements ?? [],
        embeddingGeneratedAt: opportunity.analysis?.embeddingGeneratedAt ?? null,
        contentHash: opportunity.analysis?.contentHash,
      };
      return ok({
        opportunity: withOpportunityAnalysis(opportunity, normalizedAnalysis),
        summaryStatus,
      });
    }

    if (this.analysisQueue) {
      await this.analysisQueue.enqueueAnalysis(opportunity.id, { summarize: true });
    }

    const pendingAnalysis: Analysis = {
      summary: opportunity.analysis?.summary ?? '',
      summaryStatus: 'pending',
      requirements: opportunity.analysis?.requirements ?? [],
      embeddingGeneratedAt: opportunity.analysis?.embeddingGeneratedAt ?? null,
      ...(opportunity.analysis?.contentHash
        ? { contentHash: opportunity.analysis.contentHash }
        : {}),
    };

    return ok({
      opportunity: withOpportunityAnalysis(opportunity, pendingAnalysis),
      summaryStatus: 'pending',
    });
  }
}
