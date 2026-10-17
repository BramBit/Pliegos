import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { SearchIndexPort } from '../../../domain/ports/search-index.port';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../../domain/value-objects/opportunity-filters';
import { OpportunityId, asOpportunityId } from '../../../../shared/domain/typed-id';
import { EmbedderPort } from '../../../../recommendation/domain/ports/ai-provider.port';

export const PGVECTOR_DIMENSIONS = 768;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_TABLE_NAME = 'opportunity_embeddings';
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export interface PgVectorAdapterOptions {
  readonly pool: Pool;
  readonly tableName?: string;
  readonly embedder?: EmbedderPort;
  readonly logger?: LoggerService;
}

@Injectable()
export class PgVectorAdapter implements SearchIndexPort {
  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly embedder?: EmbedderPort;
  private readonly embeddingModel: string;
  private readonly logger: LoggerService;

  constructor(options: PgVectorAdapterOptions) {
    this.pool = options.pool;
    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.embedder = options.embedder;
    this.embeddingModel = options.embedder?.model ?? DEFAULT_EMBEDDING_MODEL;
    this.logger = options.logger ?? new Logger(PgVectorAdapter.name);
  }

  /**
   * Initializes the pgvector extension and the target embeddings table with an HNSW cosine index.
   */
  async initSchema(): Promise<void> {
    const ddl = `
      CREATE EXTENSION IF NOT EXISTS vector;

      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        opportunity_id VARCHAR(255) PRIMARY KEY,
        category_code VARCHAR(100),
        department VARCHAR(100),
        contract_type VARCHAR(100),
        amount NUMERIC,
        embedding_model TEXT NOT NULL DEFAULT '${DEFAULT_EMBEDDING_MODEL}',
        embedding vector(${PGVECTOR_DIMENSIONS}) NOT NULL,
        indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector 
      ON ${this.tableName} USING hnsw (embedding vector_cosine_ops);
    `;

    await this.pool.query(ddl);
  }

  /**
   * Indexes an Opportunity by extracting relevant searchable text, generating
   * a 768-dim embedding via EmbedderPort, and upserting into pgvector with embedding_model.
   */
  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    if (!this.embedder) {
      throw new Error(
        'PgVectorAdapter: EmbedderPort is required to generate embeddings for indexOpportunity(). Provide it in constructor options.',
      );
    }

    const textParts = [
      opportunity.title,
      opportunity.contractingEntity.name,
      opportunity.categoryCode,
      opportunity.contractType,
      opportunity.procurementModality,
      opportunity.analysis?.summary ?? '',
    ].filter(Boolean);

    const fullText = textParts.join(' ');
    const [vector] = await this.embedder.embed([fullText]);

    await this.indexVector(opportunity.id, vector, {
      categoryCode: opportunity.categoryCode ?? undefined,
      department: opportunity.location.department ?? undefined,
      contractType: opportunity.contractType,
      amount: opportunity.amount.amount,
      embeddingModel: this.embedder.model,
    });
  }

  /**
   * Directly indexes an opportunity with an already-computed 768-dim vector and metadata.
   */
  async indexVector(
    opportunityId: OpportunityId,
    vector: number[],
    metadata?: {
      categoryCode?: string;
      department?: string;
      contractType?: string;
      amount?: number;
      embeddingModel?: string;
    },
  ): Promise<void> {
    if (!vector || vector.length !== PGVECTOR_DIMENSIONS) {
      throw new Error(
        `PgVectorAdapter: vector dimension mismatch. Expected ${PGVECTOR_DIMENSIONS} dimensions, received ${vector?.length ?? 0}.`,
      );
    }

    const vectorString = `[${vector.join(',')}]`;
    const model = metadata?.embeddingModel ?? this.embeddingModel;
    const query = `
      INSERT INTO ${this.tableName} (
        opportunity_id, category_code, department, contract_type, amount, embedding_model, embedding, indexed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::vector, CURRENT_TIMESTAMP)
      ON CONFLICT (opportunity_id) DO UPDATE SET
        category_code = EXCLUDED.category_code,
        department = EXCLUDED.department,
        contract_type = EXCLUDED.contract_type,
        amount = EXCLUDED.amount,
        embedding_model = EXCLUDED.embedding_model,
        embedding = EXCLUDED.embedding,
        indexed_at = CURRENT_TIMESTAMP;
    `;

    await this.pool.query(query, [
      opportunityId,
      metadata?.categoryCode ?? null,
      metadata?.department ?? null,
      metadata?.contractType ?? null,
      metadata?.amount ?? null,
      model,
      vectorString,
    ]);
  }

  /**
   * Performs semantic vector search with cosine distance (<=>), filtering by embedding_model and structured filters.
   */
  async semanticSearch(
    queryVector: number[],
    filters: OpportunityFilters = {},
    limit: number = DEFAULT_SEARCH_LIMIT,
  ): Promise<OpportunityId[]> {
    if (!queryVector || queryVector.length !== PGVECTOR_DIMENSIONS) {
      throw new Error(
        `PgVectorAdapter: query vector dimension mismatch. Expected ${PGVECTOR_DIMENSIONS} dimensions, received ${queryVector?.length ?? 0}.`,
      );
    }

    const vectorString = `[${queryVector.join(',')}]`;
    const params: unknown[] = [vectorString, this.embeddingModel];
    const whereClauses: string[] = ['embedding_model = $2'];

    if (filters.categoryCode && filters.categoryCode.trim() !== '') {
      params.push(`${filters.categoryCode.trim()}%`);
      whereClauses.push(`category_code LIKE $${params.length}`);
    }

    if (filters.department && filters.department.trim() !== '') {
      params.push(filters.department.trim());
      whereClauses.push(`department = $${params.length}`);
    }

    if (filters.contractType && filters.contractType.trim() !== '') {
      params.push(filters.contractType.trim());
      whereClauses.push(`contract_type = $${params.length}`);
    }

    if (typeof filters.amountMin === 'number' && Number.isFinite(filters.amountMin)) {
      params.push(filters.amountMin);
      whereClauses.push(`amount >= $${params.length}`);
    }

    if (typeof filters.amountMax === 'number' && Number.isFinite(filters.amountMax)) {
      params.push(filters.amountMax);
      whereClauses.push(`amount <= $${params.length}`);
    }

    params.push(limit);
    const limitParamIndex = params.length;

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
    const sql = `
      SELECT opportunity_id
      FROM ${this.tableName}
      ${whereSql}
      ORDER BY embedding <=> $1::vector ASC
      LIMIT $${limitParamIndex};
    `;

    const result: QueryResult<{ opportunity_id: string }> = await this.pool.query(sql, params);

    return result.rows.map((row) => asOpportunityId(row.opportunity_id));
  }

  /**
   * Computes cosine similarity (1 - cosine_distance) for a list of opportunityIds in one SQL query,
   * filtered by the configured embedding_model.
   */
  async similarities(
    profileVector: number[],
    opportunityIds: OpportunityId[],
  ): Promise<Map<OpportunityId, number>> {
    if (!profileVector || profileVector.length !== PGVECTOR_DIMENSIONS) {
      throw new Error(
        `PgVectorAdapter: query vector dimension mismatch. Expected ${PGVECTOR_DIMENSIONS} dimensions, received ${profileVector?.length ?? 0}.`,
      );
    }

    if (opportunityIds.length === 0) {
      return new Map();
    }

    const vectorString = `[${profileVector.join(',')}]`;
    const sql = `
      SELECT opportunity_id, 1 - (embedding <=> $1::vector) AS cosine
      FROM ${this.tableName}
      WHERE opportunity_id = ANY($2::text[])
        AND embedding_model = $3;
    `;

    const result: QueryResult<{ opportunity_id: string; cosine: number | string }> =
      await this.pool.query(sql, [vectorString, opportunityIds, this.embeddingModel]);

    const out = new Map<OpportunityId, number>();
    for (const row of result.rows) {
      out.set(asOpportunityId(row.opportunity_id), Number(row.cosine));
    }
    return out;
  }
}
