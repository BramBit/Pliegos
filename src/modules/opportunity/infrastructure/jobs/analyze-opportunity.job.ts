import { Inject, Injectable, Logger, LoggerService, Optional } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  ANALYSIS_QUEUE_NAME,
  ANALYZE_OPPORTUNITY_JOB_NAME,
  AnalyzeOpportunityJobPayload,
} from '../adapters/queue/bullmq-analysis-queue.adapter';
import {
  OPPORTUNITY_REPOSITORY_PORT,
  OpportunityRepositoryPort,
} from '../../domain/ports/opportunity.repository.port';
import {
  AI_PROVIDER_PORT,
  AIProviderPort,
} from '../../../recommendation/domain/ports/ai-provider.port';
import { SEARCH_INDEX_PORT, SearchIndexPort } from '../../domain/ports/search-index.port';
import { withOpportunityAnalysis } from '../../domain/entities/opportunity.entity';
import { Requirement } from '../../domain/value-objects/opportunity.value-objects';

export interface IJobLike<T = any> {
  data: T;
  id?: string;
}

@Processor(ANALYSIS_QUEUE_NAME, {
  concurrency: Number(process.env.ANALYSIS_CONCURRENCY) || 2,
})
@Injectable()
export class AnalyzeOpportunityJob extends WorkerHost {
  private readonly logger: LoggerService;

  constructor(
    @Inject(OPPORTUNITY_REPOSITORY_PORT)
    private readonly opportunityRepository: OpportunityRepositoryPort,
    @Inject(AI_PROVIDER_PORT) private readonly aiProvider: AIProviderPort,
    @Inject(SEARCH_INDEX_PORT) private readonly searchIndex: SearchIndexPort,
    @Optional() @Inject('ANALYSIS_JOB_LOGGER') logger?: LoggerService,
  ) {
    super();
    this.logger = logger ?? new Logger(AnalyzeOpportunityJob.name);
  }

  /**
   * BullMQ processor callback executing the asynchronous AI analysis & indexing job.
   */
  async process(job: IJobLike<AnalyzeOpportunityJobPayload>): Promise<void> {
    const { opportunityId } = job.data;

    const opportunity = await this.opportunityRepository.findById(opportunityId);
    if (!opportunity) {
      this.logger.warn(
        `AnalyzeOpportunityJob: Opportunity ${opportunityId} not found in repository. Skipping analysis.`,
      );
      return;
    }

    this.logger.log(`AnalyzeOpportunityJob: Starting analysis for Opportunity ${opportunityId}...`);

    // 1. Construct contextual text for AI processing
    const textToAnalyze = [
      `Titulo: ${opportunity.title}`,
      `Entidad contratante: ${opportunity.contractingEntity.name}`,
      `Modalidad: ${opportunity.procurementModality}`,
      `Tipo de contrato: ${opportunity.contractType}`,
      `Categoria UNSPSC: ${opportunity.categoryCode}`,
      `Presupuesto: ${opportunity.amount.amount} ${opportunity.amount.currency}`,
      `Ubicacion: ${opportunity.location.city ?? ''} ${opportunity.location.department ?? ''}`,
    ]
      .filter(Boolean)
      .join('. ');

    // 2. Generate concise Spanish analytical summary via local chat model (llama3.1)
    // Set ANALYSIS_SUMMARIZE=false for a fast embeddings-only bulk load (skips the slow LLM call)
    const summary =
      process.env.ANALYSIS_SUMMARIZE === 'false' ? '' : await this.aiProvider.summarize(textToAnalyze);

    // 3. Extract baseline requirements
    const requirements: Requirement[] = [
      {
        text: `Capacidad financiera y organizacional para ejecutar contrato por valor de ${opportunity.amount.amount.toLocaleString()} ${opportunity.amount.currency}`,
        type: 'financial',
      },
      {
        text: 'Cumplimiento de especificaciones tecnicas minimas y experiencia en contratos afines',
        type: 'technical',
      },
      {
        text: 'Habilitacion juridica para contratar con el Estado colombiano',
        type: 'legal',
      },
    ];

    // 4. Attach analysis to Opportunity aggregate root
    const analyzedOpportunity = withOpportunityAnalysis(opportunity, {
      summary: summary || 'Analisis general del pliego contractual.',
      requirements,
      embeddingGeneratedAt: new Date(),
    });

    // 5. Index opportunity in pgvector (768 dimensions via nomic-embed-text)
    await this.searchIndex.indexOpportunity(analyzedOpportunity);

    // 6. Save updated Opportunity aggregate with analysis in repository
    await this.opportunityRepository.save(analyzedOpportunity);

    this.logger.log(
      `AnalyzeOpportunityJob: Successfully completed analysis & indexing for Opportunity ${opportunityId}`,
    );
  }
}
