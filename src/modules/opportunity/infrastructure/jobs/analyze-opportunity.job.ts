import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, LoggerService, Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import {
  ANALYSIS_QUEUE_NAME,
  AnalyzeOpportunityJobPayload,
} from '../adapters/queue/bullmq-analysis-queue.adapter';
import {
  OPPORTUNITY_REPOSITORY_PORT,
  OpportunityRepositoryPort,
} from '../../domain/ports/opportunity.repository.port';
import {
  EMBEDDER_PORT,
  EmbedderPort,
  TEXT_GENERATOR_PORT,
  TextGeneratorPort,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { buildSafeSummaryUserMessage } from '../../../recommendation/infrastructure/adapters/ollama/ollama.adapter';
import { SEARCH_INDEX_PORT, SearchIndexPort } from '../../domain/ports/search-index.port';
import { Opportunity, withOpportunityAnalysis } from '../../domain/entities/opportunity.entity';
import {
  Analysis,
  Requirement,
  SummaryStatus,
} from '../../domain/value-objects/opportunity.value-objects';

export const MAX_SUMMARY_OUTPUT_CHARS = 600;
export const FALLBACK_DESCRIPTION_CHARS = 300;

export interface IJobLike<T = any> {
  data: T;
  id?: string;
}

export function computeAnalysisContentHash(
  opportunity: Pick<Opportunity, 'title' | 'description' | 'contractingEntity' | 'contractType'>,
  embeddingModel: string = 'nomic-embed-text',
): string {
  const payload = [
    opportunity.title,
    opportunity.description,
    opportunity.contractingEntity.name,
    opportunity.contractType,
    embeddingModel,
  ].join('|');
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function hasGeneratedSummary(analysis: Analysis | null | undefined): boolean {
  if (!analysis) return false;
  if (analysis.summaryStatus === 'ready' || analysis.summaryStatus === 'fallback') {
    return true;
  }
  if (!analysis.summaryStatus && Boolean(analysis.summary?.trim())) {
    return true;
  }
  return false;
}

@Processor(ANALYSIS_QUEUE_NAME, {
  concurrency: 2,
})
@Injectable()
export class AnalyzeOpportunityJob extends WorkerHost {
  private readonly logger: LoggerService;
  private readonly embeddingModel: string;

  constructor(
    @Inject(OPPORTUNITY_REPOSITORY_PORT)
    private readonly opportunityRepository: OpportunityRepositoryPort,
    @Inject(TEXT_GENERATOR_PORT) private readonly textGenerator: TextGeneratorPort,
    @Inject(SEARCH_INDEX_PORT) private readonly searchIndex: SearchIndexPort,
    @Optional() @Inject('ANALYSIS_JOB_LOGGER') logger?: LoggerService,
    @Optional() @Inject(EMBEDDER_PORT) embedderOrModel?: Pick<EmbedderPort, 'model'> | string,
  ) {
    super();
    this.logger = logger ?? new Logger(AnalyzeOpportunityJob.name);
    this.embeddingModel =
      typeof embedderOrModel === 'string'
        ? embedderOrModel
        : embedderOrModel?.model ?? 'nomic-embed-text';
  }

  /**
   * BullMQ processor callback executing the asynchronous AI analysis & indexing job.
   * Uses a Postgres session-level advisory lock per opportunity and persists only the
   * `analysis` column so concurrent updates (e.g. closing_date or status) are never overwritten.
   */
  async process(job: IJobLike<AnalyzeOpportunityJobPayload>): Promise<void> {
    const { opportunityId, summarize } = job.data;
    const shouldSummarize = summarize !== false;

    const runWork = async () => {
      const opportunity = await this.opportunityRepository.findById(opportunityId);
      if (!opportunity) {
        this.logger.warn(
          `AnalyzeOpportunityJob: Opportunity ${opportunityId} not found in repository. Skipping analysis.`,
        );
        return;
      }

      const contentHash = computeAnalysisContentHash(opportunity, this.embeddingModel);
      const embeddingUpToDate =
        opportunity.analysis?.contentHash === contentHash &&
        Boolean(opportunity.analysis?.embeddingGeneratedAt);
      const summaryUpToDate =
        opportunity.analysis?.contentHash === contentHash &&
        hasGeneratedSummary(opportunity.analysis);

      if (!shouldSummarize && embeddingUpToDate) {
        this.logger.log(
          `AnalyzeOpportunityJob: Skipping Opportunity ${opportunityId} — contentHash ${contentHash} unchanged (embed-only).`,
        );
        return;
      }

      if (shouldSummarize && embeddingUpToDate && summaryUpToDate) {
        this.logger.log(
          `AnalyzeOpportunityJob: Skipping Opportunity ${opportunityId} — contentHash ${contentHash} unchanged.`,
        );
        return;
      }

      this.logger.log(`AnalyzeOpportunityJob: Starting analysis for Opportunity ${opportunityId}...`);

      let summary = '';
      let summaryStatus: SummaryStatus = 'unavailable';

      if (shouldSummarize) {
        const userMessage = buildSafeSummaryUserMessage(
          opportunity.title,
          opportunity.description ?? '',
        );

        try {
          const rawSummary = (await this.textGenerator.summarize(userMessage)).trim();
          if (rawSummary.length > 0 && rawSummary.length <= MAX_SUMMARY_OUTPUT_CHARS) {
            summary = rawSummary;
            summaryStatus = 'ready';
          } else {
            summary = (opportunity.description ?? '').slice(0, FALLBACK_DESCRIPTION_CHARS);
            summaryStatus = 'fallback';
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `AnalyzeOpportunityJob: LLM summarize failed for Opportunity ${opportunityId} (${msg}); using fallback.`,
          );
          summary = (opportunity.description ?? '').slice(0, FALLBACK_DESCRIPTION_CHARS);
          summaryStatus = 'fallback';
        }
      } else if (opportunity.analysis?.contentHash === contentHash && opportunity.analysis.summaryStatus) {
        summary = opportunity.analysis.summary;
        summaryStatus = opportunity.analysis.summaryStatus;
      }

      const requirements: Requirement[] = [];
      const embeddingGeneratedAt =
        embeddingUpToDate && opportunity.analysis?.embeddingGeneratedAt
          ? opportunity.analysis.embeddingGeneratedAt
          : new Date();

      const analysis: Analysis = {
        summary,
        summaryStatus,
        requirements,
        embeddingGeneratedAt,
        contentHash,
      };

      const analyzedOpportunity = withOpportunityAnalysis(opportunity, analysis);

      if (!embeddingUpToDate) {
        await this.searchIndex.indexOpportunity(analyzedOpportunity);
      }

      await this.opportunityRepository.saveAnalysis(opportunity.id, analysis);

      this.logger.log(
        `AnalyzeOpportunityJob: Successfully completed analysis & indexing for Opportunity ${opportunityId}`,
      );
    };

    if (this.opportunityRepository.withAnalysisLock) {
      await this.opportunityRepository.withAnalysisLock(opportunityId, runWork);
    } else {
      await runWork();
    }
  }
}
