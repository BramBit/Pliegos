import { createHash } from 'node:crypto';
import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  SearchIndexPort,
  CandidateRetrievalQuery,
  CandidateRetrievalFilters,
  CandidateRetrievalResult,
  RetrievalLevel,
  reciprocalRankFusion,
  buildProfileOrTsQuery,
} from '../../../domain/ports/search-index.port';
import {
  Opportunity,
  buildIndexText,
} from '../../../domain/entities/opportunity.entity';
import { OpportunityFilters } from '../../../domain/value-objects/opportunity-filters';
import {
  OpportunityId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';
import { EmbedderPort } from '../../../../recommendation/domain/ports/ai-provider.port';

export { reciprocalRankFusion, buildProfileOrTsQuery };

export const PGVECTOR_DIMENSIONS = 768;
export const DEFAULT_SEARCH_LIMIT = 20;
export const DEFAULT_TABLE_NAME = 'opportunity_embeddings';
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text';

export function computeIndexTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

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
        text_hash TEXT,
        embedding vector(${PGVECTOR_DIMENSIONS}) NOT NULL,
        indexed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_vector 
      ON ${this.tableName} USING hnsw (embedding vector_cosine_ops);
    `;

    await this.pool.query(ddl);
  }

  /**
   * Indexes an Opportunity by building index text via buildIndexText(opportunity),
   * generating a 768-dim embedding via EmbedderPort, and upserting into pgvector
   * with embedding_model and text_hash.
   */
  async indexOpportunity(opportunity: Opportunity): Promise<void> {
    if (!this.embedder) {
      throw new Error(
        'PgVectorAdapter: EmbedderPort is required to generate embeddings for indexOpportunity(). Provide it in constructor options.',
      );
    }

    const fullText = buildIndexText(opportunity);
    const textHash = computeIndexTextHash(fullText);
    const [vector] = await this.embedder.embed([fullText]);

    await this.indexVector(opportunity.id, vector, {
      categoryCode: opportunity.categoryCode ?? undefined,
      department: opportunity.location.department ?? undefined,
      contractType: opportunity.contractType,
      amount: opportunity.amount.amount,
      embeddingModel: this.embedder.model,
      textHash,
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
      textHash?: string;
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
        opportunity_id, category_code, department, contract_type, amount, embedding_model, text_hash, embedding, indexed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, CURRENT_TIMESTAMP)
      ON CONFLICT (opportunity_id) DO UPDATE SET
        category_code = EXCLUDED.category_code,
        department = EXCLUDED.department,
        contract_type = EXCLUDED.contract_type,
        amount = EXCLUDED.amount,
        embedding_model = EXCLUDED.embedding_model,
        text_hash = EXCLUDED.text_hash,
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
      metadata?.textHash ?? null,
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

    if (
      typeof filters.amountMin === 'number' &&
      Number.isFinite(filters.amountMin)
    ) {
      params.push(filters.amountMin);
      whereClauses.push(`amount >= $${params.length}`);
    }

    if (
      typeof filters.amountMax === 'number' &&
      Number.isFinite(filters.amountMax)
    ) {
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

    const result: QueryResult<{ opportunity_id: string }> =
      await this.pool.query(sql, params);

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

    const result: QueryResult<{
      opportunity_id: string;
      cosine: number | string;
    }> = await this.pool.query(sql, [
      vectorString,
      opportunityIds,
      this.embeddingModel,
    ]);

    const out = new Map<OpportunityId, number>();
    for (const row of result.rows) {
      out.set(asOpportunityId(row.opportunity_id), Number(row.cosine));
    }
    return out;
  }

  /**
   * Hybrid candidate retrieval combining pgvector cosine search and Spanish full-text search
   * via Reciprocal Rank Fusion (RRF), with graceful degradation when one branch fails.
   */
  async retrieveCandidates(
    query: CandidateRetrievalQuery,
    filters: CandidateRetrievalFilters = {},
    limit: number = DEFAULT_SEARCH_LIMIT,
  ): Promise<CandidateRetrievalResult> {
    const branchLimit = Math.max(1, limit) * 3;

    const [vectorOutcome, fulltextOutcome] = await Promise.allSettled([
      this.runVectorCandidateQuery(query.vector, filters, branchLimit),
      this.runFullTextCandidateQuery(query, filters, branchLimit),
    ]);

    if (
      vectorOutcome.status === 'rejected' &&
      fulltextOutcome.status === 'rejected'
    ) {
      throw vectorOutcome.reason ?? fulltextOutcome.reason;
    }

    const cosineById = new Map<string, number>();
    const textRankById = new Map<string, number>();
    const listsToFuse: Array<Array<{ id: string }>> = [];
    let level: RetrievalLevel = 'hybrid';
    let degraded = false;

    if (vectorOutcome.status === 'fulfilled') {
      for (const row of vectorOutcome.value) {
        cosineById.set(row.id, row.cosine);
      }
      listsToFuse.push(vectorOutcome.value);
    } else {
      degraded = true;
      level = 'fulltext';
      this.logger.warn(
        `PgVectorAdapter.retrieveCandidates: vector query failed (${(vectorOutcome.reason as Error)?.message ?? vectorOutcome.reason}); degrading to fulltext.`,
      );
    }

    if (fulltextOutcome.status === 'fulfilled') {
      for (const row of fulltextOutcome.value) {
        textRankById.set(row.id, row.textRank);
      }
      listsToFuse.push(fulltextOutcome.value);
    } else {
      degraded = true;
      level = 'vector';
      this.logger.warn(
        `PgVectorAdapter.retrieveCandidates: full-text query failed (${(fulltextOutcome.reason as Error)?.message ?? fulltextOutcome.reason}); degrading to vector.`,
      );
    }

    const fused = reciprocalRankFusion(listsToFuse, 60, limit);
    const items = fused.map((entry) => ({
      id: asOpportunityId(entry.id),
      cosine: cosineById.get(entry.id) ?? null,
      textRank: textRankById.get(entry.id) ?? null,
      fusedScore: entry.fusedScore,
    }));

    return {
      items,
      level,
      degraded,
    };
  }

  private buildOpportunityFilterClauses(
    filters: CandidateRetrievalFilters,
    params: unknown[],
  ): string[] {
    const clauses: string[] = [];

    if (filters.hardExclusionsOnly) {
      clauses.push(
        `o.is_competitive = TRUE`,
        `(o.status IN ('Published', 'Amended') OR (o.status = 'Unknown' AND (o.closing_date >= NOW() OR o.published_at >= NOW() - INTERVAL '30 days')))`,
        `(o.closing_date IS NULL OR o.closing_date >= NOW())`,
      );
      return clauses;
    }

    if (filters.actionable) {
      clauses.push(
        `o.status IN ('Published', 'Amended')`,
        `o.is_competitive = TRUE`,
        `(o.closing_date IS NULL OR o.closing_date >= NOW())`,
      );
    } else {
      if (filters.onlyCompetitive) {
        clauses.push(`o.is_competitive = TRUE`);
      }
      if (filters.onlyOpen) {
        clauses.push(
          `o.status IN ('Published', 'Amended')`,
          `(o.closing_date IS NULL OR o.closing_date >= NOW())`,
        );
      }
    }

    if (filters.department && filters.department.trim() !== '') {
      params.push(filters.department.trim());
      clauses.push(`o.department = $${params.length}`);
    }

    if (filters.categoryCode && filters.categoryCode.trim() !== '') {
      const rawPrefix = filters.categoryCode.trim();
      const strippedPrefix = rawPrefix.replace(/^v1\./i, '');
      params.push(`${rawPrefix}%`, `${strippedPrefix}%`);
      clauses.push(
        `(o.category_code LIKE $${params.length - 1} OR o.category_code LIKE $${params.length})`,
      );
    }

    if (filters.contractType && filters.contractType.trim() !== '') {
      params.push(filters.contractType.trim());
      clauses.push(`o.contract_type = $${params.length}`);
    }

    if (filters.modality && filters.modality.trim() !== '') {
      params.push(filters.modality.trim());
      clauses.push(`LOWER(o.procurement_modality) = LOWER($${params.length})`);
    }

    if (filters.status && filters.status.trim() !== '') {
      params.push(filters.status.trim());
      clauses.push(`o.status = $${params.length}`);
    }

    if (
      filters.closingAfter instanceof Date &&
      !isNaN(filters.closingAfter.getTime())
    ) {
      params.push(filters.closingAfter);
      clauses.push(`o.closing_date >= $${params.length}`);
    }

    if (
      filters.closingBefore instanceof Date &&
      !isNaN(filters.closingBefore.getTime())
    ) {
      params.push(filters.closingBefore);
      clauses.push(`o.closing_date <= $${params.length}`);
    }

    if (
      typeof filters.amountMin === 'number' &&
      Number.isFinite(filters.amountMin)
    ) {
      params.push(filters.amountMin);
      clauses.push(`o.amount >= $${params.length}`);
    }

    if (
      typeof filters.amountMax === 'number' &&
      Number.isFinite(filters.amountMax)
    ) {
      params.push(filters.amountMax);
      clauses.push(`o.amount <= $${params.length}`);
    }

    return clauses;
  }

  private async runVectorCandidateQuery(
    queryVector: number[],
    filters: CandidateRetrievalFilters,
    limit: number,
  ): Promise<Array<{ id: string; cosine: number }>> {
    if (!queryVector || queryVector.length !== PGVECTOR_DIMENSIONS) {
      throw new Error(
        `PgVectorAdapter: query vector dimension mismatch. Expected ${PGVECTOR_DIMENSIONS} dimensions, received ${queryVector?.length ?? 0}.`,
      );
    }

    const vectorString = `[${queryVector.join(',')}]`;
    const params: unknown[] = [vectorString, this.embeddingModel];
    const whereClauses: string[] = [
      'e.embedding_model = $2',
      ...this.buildOpportunityFilterClauses(filters, params),
    ];

    params.push(limit);
    const limitIdx = params.length;

    const sql = `
      SELECT e.opportunity_id AS id, 1 - (e.embedding <=> $1::vector) AS cosine
      FROM ${this.tableName} e
      JOIN opportunities o ON o.id = e.opportunity_id
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY e.embedding <=> $1::vector ASC
      LIMIT $${limitIdx};
    `;

    const result: QueryResult<{ id: string; cosine: number | string }> =
      await this.pool.query(sql, params);

    return result.rows.map((r) => ({
      id: r.id,
      cosine: Number(r.cosine),
    }));
  }

  private async runFullTextCandidateQuery(
    query: CandidateRetrievalQuery,
    filters: CandidateRetrievalFilters,
    limit: number,
  ): Promise<Array<{ id: string; textRank: number }>> {
    const mode = query.mode ?? 'profile';
    const tsQueryFn = mode === 'user' ? 'websearch_to_tsquery' : 'to_tsquery';
    const queryArg =
      mode === 'user'
        ? (query.text ?? '').trim()
        : buildProfileOrTsQuery(query.text ?? '');

    if (!queryArg) {
      return [];
    }

    const params: unknown[] = [queryArg];
    const whereClauses: string[] = [
      'o.search_tsv @@ q.tsq',
      ...this.buildOpportunityFilterClauses(filters, params),
    ];

    params.push(limit);
    const limitIdx = params.length;

    const sql = `
      SELECT o.id, ts_rank_cd(o.search_tsv, q.tsq) AS text_rank
      FROM opportunities o, ${tsQueryFn}('spanish', $1) AS q(tsq)
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY text_rank DESC
      LIMIT $${limitIdx};
    `;

    const result: QueryResult<{ id: string; text_rank: number | string }> =
      await this.pool.query(sql, params);

    return result.rows.map((r) => ({
      id: r.id,
      textRank: Number(r.text_rank),
    }));
  }
}
