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
import { SEARCH_INDEX_PORT, SearchIndexPort } from '../../domain/ports/search-index.port';
import { Opportunity, withOpportunityAnalysis } from '../../domain/entities/opportunity.entity';
import { Analysis, Requirement } from '../../domain/value-objects/opportunity.value-objects';

export interface IJobLike<T = any> {
  data: T;
  id?: string;
}

export function computeAnalysisContentHash(
  opportunity: Pick<Opportunity, 'title' | 'description' | 'contractingEntity' | 'contractType'>,
  embeddingModel: string = process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
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

@Processor(ANALYSIS_QUEUE_NAME, {
  concurrency: Number(process.env.ANALYSIS_CONCURRENCY) || 2,
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
        : embedderOrModel?.model ?? (process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text');
  }

  /**
   * BullMQ processor callback executing the asynchronous AI analysis & indexing job.
   * Uses a Postgres session-level advisory lock per opportunity and persists only the
   * `analysis` column so concurrent updates (e.g. closing_date or status) are never overwritten.
   */
  async process(job: IJobLike<AnalyzeOpportunityJobPayload>): Promise<void> {
    const { opportunityId } = job.data;

    const runWork = async () => {
      const opportunity = await this.opportunityRepository.findById(opportunityId);
      if (!opportunity) {
        this.logger.warn(
          `AnalyzeOpportunityJob: Opportunity ${opportunityId} not found in repository. Skipping analysis.`,
        );
        return;
      }

      const contentHash = computeAnalysisContentHash(opportunity, this.embeddingModel);
      if (opportunity.analysis?.contentHash === contentHash) {
        this.logger.log(
          `AnalyzeOpportunityJob: Skipping Opportunity ${opportunityId} — contentHash ${contentHash} unchanged.`,
        );
        return;
      }

      this.logger.log(`AnalyzeOpportunityJob: Starting analysis for Opportunity ${opportunityId}...`);

      // 1. Construct contextual text for AI processing
      const textToAnalyze = [
        `Titulo: ${opportunity.title}`,
        opportunity.description ? `Descripcion: ${opportunity.description}` : '',
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
        process.env.ANALYSIS_SUMMARIZE === 'false'
          ? ''
          : await this.textGenerator.summarize(textToAnalyze);

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

      const analysis: Analysis = {
        summary: summary || 'Analisis general del pliego contractual.',
        requirements,
        embeddingGeneratedAt: new Date(),
        contentHash,
      };

      // 4. Attach analysis in memory for pgvector indexing
      const analyzedOpportunity = withOpportunityAnalysis(opportunity, analysis);

      // 5. Index opportunity in pgvector (768 dimensions via nomic-embed-text)
      await this.searchIndex.indexOpportunity(analyzedOpportunity);

      // 6. Persist ONLY the analysis column so concurrent row updates are never overwritten
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
