import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  RecommendationRepositoryPort,
  ProfileEmbeddingRecord,
  RecommendationRun,
  RecommendationPageOptions,
  PagedRecommendations,
} from '../../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../../domain/entities/recommendation.entity';
import {
  RecommendationId,
  ProfileId,
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';
import { RetrievalLevel } from '../../../../opportunity/domain/ports/search-index.port';

interface RecommendationRow {
  id: string;
  profile_id: string;
  opportunity_id: string;
  score: string | number;
  explanation: any;
  feedback: any;
  total_count?: string | number;
}

interface ProfileEmbeddingRow {
  profile_id: string;
  text_hash: string;
  embedding_model: string;
  embedding: string;
}

interface RecommendationRunRow {
  id: string;
  profile_id: string;
  started_at: Date | string;
  finished_at: Date | string;
  candidates: number | string;
  kept: number | string;
  level: string;
  degraded: boolean;
}

@Injectable()
export class PostgresRecommendationRepository implements RecommendationRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(recommendation: Recommendation): Promise<void> {
    const query = `
      INSERT INTO recommendations (
        id, profile_id, opportunity_id, score, explanation, feedback, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        score = EXCLUDED.score,
        explanation = EXCLUDED.explanation,
        feedback = EXCLUDED.feedback,
        updated_at = CURRENT_TIMESTAMP;
    `;

    const values = [
      recommendation.id,
      recommendation.profileId,
      recommendation.opportunityId,
      recommendation.score,
      JSON.stringify(recommendation.explanation),
      recommendation.feedback ? JSON.stringify(recommendation.feedback) : null,
    ];

    await this.pool.query(query, values);
  }

  /**
   * Upserts the top recommendations for a profile using UNIQUE(profile_id, opportunity_id),
   * preserving existing id and feedback, and deletes stale rows outside the top set
   * that have no feedback.
   */
  async upsertMany(
    profileId: ProfileId,
    recommendations: Recommendation[],
  ): Promise<Recommendation[]> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const keptRows: Recommendation[] = [];
      const keptOpportunityIds: string[] = [];

      for (const rec of recommendations) {
        keptOpportunityIds.push(rec.opportunityId);
        const res: QueryResult<RecommendationRow> = await client.query(
          `INSERT INTO recommendations (
             id, profile_id, opportunity_id, score, explanation, feedback, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (profile_id, opportunity_id) DO UPDATE SET
             score = EXCLUDED.score,
             explanation = EXCLUDED.explanation,
             feedback = COALESCE(recommendations.feedback, EXCLUDED.feedback),
             updated_at = CURRENT_TIMESTAMP
           RETURNING *;`,
          [
            rec.id,
            profileId,
            rec.opportunityId,
            rec.score,
            JSON.stringify(rec.explanation),
            rec.feedback ? JSON.stringify(rec.feedback) : null,
          ],
        );
        keptRows.push(this.mapRowToEntity(res.rows[0]));
      }

      if (keptOpportunityIds.length > 0) {
        await client.query(
          `DELETE FROM recommendations
           WHERE profile_id = $1
             AND feedback IS NULL
             AND NOT (opportunity_id = ANY($2::text[]));`,
          [profileId, keptOpportunityIds],
        );
      } else {
        await client.query(
          `DELETE FROM recommendations
           WHERE profile_id = $1
             AND feedback IS NULL;`,
          [profileId],
        );
      }

      await client.query('COMMIT');
      return keptRows;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async findByProfile(profileId: ProfileId): Promise<Recommendation[]> {
    const res: QueryResult<RecommendationRow> = await this.pool.query(
      'SELECT * FROM recommendations WHERE profile_id = $1 ORDER BY score DESC;',
      [profileId],
    );

    return res.rows.map((row) => this.mapRowToEntity(row));
  }

  async findByProfilePaged(
    profileId: ProfileId,
    options: RecommendationPageOptions = {},
  ): Promise<PagedRecommendations> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [profileId];
    const where: string[] = ['profile_id = $1'];

    if (typeof options.minScore === 'number' && Number.isFinite(options.minScore)) {
      params.push(options.minScore);
      where.push(`score >= $${params.length}`);
    }

    params.push(pageSize, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const sql = `
      SELECT *, COUNT(*) OVER() AS total_count
      FROM recommendations
      WHERE ${where.join(' AND ')}
      ORDER BY score DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res: QueryResult<RecommendationRow> = await this.pool.query(sql, params);
    const total = res.rows.length > 0 ? Number(res.rows[0].total_count ?? 0) : 0;

    return {
      items: res.rows.map((row) => this.mapRowToEntity(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(id: RecommendationId): Promise<Recommendation | null> {
    const res: QueryResult<RecommendationRow> = await this.pool.query(
      'SELECT * FROM recommendations WHERE id = $1;',
      [id],
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async getProfileEmbedding(profileId: ProfileId): Promise<ProfileEmbeddingRecord | null> {
    const res: QueryResult<ProfileEmbeddingRow> = await this.pool.query(
      `SELECT profile_id, text_hash, embedding_model, embedding::text AS embedding
       FROM profile_embeddings
       WHERE profile_id = $1;`,
      [profileId],
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    const parsedVector = JSON.parse(row.embedding) as number[];

    return {
      profileId: asProfileId(row.profile_id),
      textHash: row.text_hash,
      embeddingModel: row.embedding_model,
      embedding: parsedVector,
    };
  }

  async saveProfileEmbedding(record: ProfileEmbeddingRecord): Promise<void> {
    const vectorString = `[${record.embedding.join(',')}]`;
    await this.pool.query(
      `INSERT INTO profile_embeddings (profile_id, text_hash, embedding_model, embedding, updated_at)
       VALUES ($1, $2, $3, $4::vector, NOW())
       ON CONFLICT (profile_id) DO UPDATE SET
         text_hash = EXCLUDED.text_hash,
         embedding_model = EXCLUDED.embedding_model,
         embedding = EXCLUDED.embedding,
         updated_at = NOW();`,
      [record.profileId, record.textHash, record.embeddingModel, vectorString],
    );
  }

  async recordRun(run: RecommendationRun): Promise<void> {
    await this.pool.query(
      `INSERT INTO recommendation_runs (
         id, profile_id, started_at, finished_at, candidates, kept, level, degraded
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8);`,
      [
        run.id,
        run.profileId,
        run.startedAt,
        run.finishedAt,
        run.candidates,
        run.kept,
        run.level,
        run.degraded,
      ],
    );
  }

  async getLatestRun(profileId: ProfileId): Promise<RecommendationRun | null> {
    const res: QueryResult<RecommendationRunRow> = await this.pool.query(
      `SELECT *
       FROM recommendation_runs
       WHERE profile_id = $1
       ORDER BY finished_at DESC, started_at DESC
       LIMIT 1;`,
      [profileId],
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return {
      id: row.id,
      profileId: asProfileId(row.profile_id),
      startedAt: new Date(row.started_at),
      finishedAt: new Date(row.finished_at),
      candidates: Number(row.candidates),
      kept: Number(row.kept),
      level: row.level as RetrievalLevel,
      degraded: Boolean(row.degraded),
    };
  }

  async findAllProfileIds(): Promise<ProfileId[]> {
    const res: QueryResult<{ id: string }> = await this.pool.query(
      'SELECT id FROM profiles ORDER BY created_at ASC, id ASC;',
    );
    return res.rows.map((r) => asProfileId(r.id));
  }

  private mapRowToEntity(row: RecommendationRow): Recommendation {
    const explanation =
      typeof row.explanation === 'string'
        ? JSON.parse(row.explanation)
        : row.explanation;
    const feedback =
      typeof row.feedback === 'string'
        ? JSON.parse(row.feedback)
        : row.feedback;

    return {
      id: asRecommendationId(row.id),
      profileId: asProfileId(row.profile_id),
      opportunityId: asOpportunityId(row.opportunity_id),
      score: parseFloat(row.score.toString()),
      explanation,
      feedback: feedback
        ? {
            decision: feedback.decision,
            recordedAt: new Date(feedback.recordedAt),
          }
        : null,
    };
  }
}
