import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { SearchIndexPort } from '../../../domain/ports/search-index.port';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../../domain/value-objects/opportunity-filters';
import { OpportunityId, asOpportunityId } from '../../../../shared/domain/typed-id';
import { AIProviderPort } from '../../../../recommendation/domain/ports/ai-provider.port';

export const PGVECTOR_DIMENSIONS = 768;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_TABLE_NAME = 'opportunity_embeddings';

export interface PgVectorAdapterOptions {
  readonly pool: Pool;
  readonly tableName?: string;
  readonly aiProvider?: AIProviderPort;
  readonly logger?: LoggerService;
}

@Injectable()
export class PgVectorAdapter implements SearchIndexPort {
  private readonly pool: Pool;
  private readonly tableName: string;
  private readonly aiProvider?: AIProviderPort;
  private readonly logger: LoggerService;

  constructor(options: PgVectorAdapterOptions) {
    this.pool = options.pool;
    this.tableName = options.tableName ?? DEFAULT_TABLE_NAME;
    this.aiProvider = options.aiProvider;
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
   * a 768-dim embedding via AIProviderPort, and upserting into pgvector.
   */
  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    if (!this.aiProvider) {
      throw new Error(
        'PgVectorAdapter: AIProviderPort is required to generate embeddings for indexOpportunity(). Provide it in constructor options.',
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
    const vector = await this.aiProvider.embed(fullText);

    await this.indexVector(opportunity.id, vector, {
      categoryCode: opportunity.categoryCode,
      department: opportunity.location.department ?? undefined,
      contractType: opportunity.contractType,
      amount: opportunity.amount.amount,
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
    },
  ): Promise<void> {
    if (!vector || vector.length !== PGVECTOR_DIMENSIONS) {
      throw new Error(
        `PgVectorAdapter: vector dimension mismatch. Expected ${PGVECTOR_DIMENSIONS} dimensions, received ${vector?.length ?? 0}.`,
      );
    }

    const vectorString = `[${vector.join(',')}]`;
    const query = `
      INSERT INTO ${this.tableName} (
        opportunity_id, category_code, department, contract_type, amount, embedding, indexed_at
      ) VALUES ($1, $2, $3, $4, $5, $6::vector, CURRENT_TIMESTAMP)
      ON CONFLICT (opportunity_id) DO UPDATE SET
        category_code = EXCLUDED.category_code,
        department = EXCLUDED.department,
        contract_type = EXCLUDED.contract_type,
        amount = EXCLUDED.amount,
        embedding = EXCLUDED.embedding,
        indexed_at = CURRENT_TIMESTAMP;
    `;

    await this.pool.query(query, [
      opportunityId,
      metadata?.categoryCode ?? null,
      metadata?.department ?? null,
      metadata?.contractType ?? null,
      metadata?.amount ?? null,
      vectorString,
    ]);
  }

  /**
   * Performs semantic vector search with cosine distance (<=>) and structured filters.
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
    const whereClauses: string[] = [];
    const params: unknown[] = [vectorString];

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

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
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
}
