import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  RecommendationRepositoryPort,
  ProfileEmbeddingRecord,
  RecommendationRun,
  RecommendationPageOptions,
  PagedRecommendations,
  RecommendationFeedOptions,
  PagedRecommendationFeed,
  RecommendationFeedItem,
} from '../../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../../domain/entities/recommendation.entity';
import { Opportunity } from '../../../../opportunity/domain/entities/opportunity.entity';
import {
  OpportunityStatus,
  SummaryStatus,
} from '../../../../opportunity/domain/value-objects/opportunity.value-objects';
import {
  RecommendationId,
  ProfileId,
  UserId,
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
  match_tier?: number | string;
  missing_criteria?: string[];
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
        id, profile_id, opportunity_id, score, explanation, feedback, match_tier, missing_criteria, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        score = EXCLUDED.score,
        explanation = EXCLUDED.explanation,
        feedback = EXCLUDED.feedback,
        match_tier = EXCLUDED.match_tier,
        missing_criteria = EXCLUDED.missing_criteria,
        updated_at = CURRENT_TIMESTAMP;
    `;

    const values = [
      recommendation.id,
      recommendation.profileId,
      recommendation.opportunityId,
      recommendation.score,
      JSON.stringify(recommendation.explanation),
      recommendation.feedback ? JSON.stringify(recommendation.feedback) : null,
      recommendation.matchTier ?? 1,
      recommendation.missingCriteria ?? [],
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
             id, profile_id, opportunity_id, score, explanation, feedback, match_tier, missing_criteria, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           ON CONFLICT (profile_id, opportunity_id) DO UPDATE SET
             score = EXCLUDED.score,
             explanation = EXCLUDED.explanation,
             feedback = COALESCE(recommendations.feedback, EXCLUDED.feedback),
             match_tier = EXCLUDED.match_tier,
             missing_criteria = EXCLUDED.missing_criteria,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *;`,
          [
            rec.id,
            profileId,
            rec.opportunityId,
            rec.score,
            JSON.stringify(rec.explanation),
            rec.feedback ? JSON.stringify(rec.feedback) : null,
            rec.matchTier ?? 1,
            rec.missingCriteria ?? [],
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
      'SELECT * FROM recommendations WHERE profile_id = $1 ORDER BY match_tier ASC, score DESC;',
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

    if (
      typeof options.minScore === 'number' &&
      Number.isFinite(options.minScore)
    ) {
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
      ORDER BY match_tier ASC, score DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res: QueryResult<RecommendationRow> = await this.pool.query(
      sql,
      params,
    );
    const total =
      res.rows.length > 0 ? Number(res.rows[0].total_count ?? 0) : 0;

    return {
      items: res.rows.map((row) => this.mapRowToEntity(row)),
      total,
      page,
      pageSize,
    };
  }

  async findById(
    id: RecommendationId,
    userId?: UserId,
  ): Promise<Recommendation | null> {
    const sql = userId
      ? `SELECT r.* FROM recommendations r
         JOIN profiles p ON p.id = r.profile_id
         WHERE r.id = $1 AND p.owner_id = $2;`
      : 'SELECT * FROM recommendations WHERE id = $1;';
    const params = userId ? [id, userId] : [id];
    const res: QueryResult<RecommendationRow> = await this.pool.query(
      sql,
      params,
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findFeed(
    profileId: ProfileId,
    options: RecommendationFeedOptions = {},
  ): Promise<PagedRecommendationFeed> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const offset = (page - 1) * pageSize;
    const state = options.state ?? 'new';
    const minScore =
      typeof options.minScore === 'number' && Number.isFinite(options.minScore)
        ? options.minScore
        : null;
    const includeMismatches = options.includeMismatches ?? false;

    const query = `
      WITH profile_check AS (
        SELECT id FROM profiles WHERE id = $1
      ),
      latest_run AS (
        SELECT finished_at, degraded
        FROM recommendation_runs
        WHERE profile_id = $1
        ORDER BY finished_at DESC, started_at DESC
        LIMIT 1
      ),
      base_recs AS (
        SELECT
          r.id,
          r.profile_id,
          r.opportunity_id,
          r.score,
          r.explanation,
          r.feedback,
          COALESCE(r.match_tier, 1) AS match_tier,
          COALESCE(r.missing_criteria, '{}') AS missing_criteria,
          row_to_json(o.*) AS opp_json
        FROM recommendations r
        JOIN opportunities o ON o.id = r.opportunity_id
        WHERE r.profile_id = $1
          AND (
            $2 = 'all' OR
            ($2 = 'new' AND r.feedback IS NULL) OR
            ($2 = 'participate' AND r.feedback->>'decision' = 'Participate') OR
            ($2 = 'discard' AND r.feedback->>'decision' = 'Discard')
          )
          AND ($3::numeric IS NULL OR r.score >= $3)
      ),
      filtered_recs AS (
        SELECT *
        FROM base_recs
        WHERE ($4::boolean = TRUE OR match_tier <> 3)
      ),
      paged_recs AS (
        SELECT *
        FROM filtered_recs
        ORDER BY match_tier ASC, score DESC, id ASC
        LIMIT $5 OFFSET $6
      )
      SELECT
        (EXISTS(SELECT 1 FROM profile_check)) AS profile_exists,
        (SELECT COUNT(*) FROM filtered_recs) AS total_count,
        (SELECT COUNT(*) FILTER (WHERE match_tier = 1) FROM filtered_recs) AS tier_1_count,
        (SELECT COUNT(*) FILTER (WHERE match_tier = 2) FROM filtered_recs) AS tier_2_count,
        (SELECT COUNT(*) FILTER (WHERE match_tier = 3) FROM filtered_recs) AS tier_3_count,
        (SELECT row_to_json(lr) FROM latest_run lr) AS latest_run,
        (SELECT COALESCE(json_agg(pr), '[]'::json) FROM paged_recs pr) AS items;
    `;

    const res = await this.pool.query(query, [
      profileId,
      state,
      minScore,
      includeMismatches,
      pageSize,
      offset,
    ]);
    const row = res.rows[0];
    const profileExists = Boolean(row?.profile_exists);
    const total = Number(row?.total_count ?? 0);
    const latestRunRaw = row?.latest_run;
    const lastRefreshedAt = latestRunRaw?.finished_at
      ? new Date(latestRunRaw.finished_at)
      : null;
    const degraded = Boolean(latestRunRaw?.degraded ?? false);

    const itemsRaw: any[] = row?.items ?? [];
    const items: RecommendationFeedItem[] = itemsRaw.map((r: any) => {
      const opportunity = this.mapOpportunityRow(r.opp_json);
      const explanation =
        typeof r.explanation === 'string'
          ? JSON.parse(r.explanation)
          : r.explanation;
      const feedback =
        typeof r.feedback === 'string' ? JSON.parse(r.feedback) : r.feedback;

      return {
        id: asRecommendationId(r.id),
        profileId: asProfileId(r.profile_id),
        opportunityId: asOpportunityId(r.opportunity_id),
        score: parseFloat(r.score.toString()),
        explanation,
        feedback: feedback
          ? {
              decision: feedback.decision,
              recordedAt: new Date(feedback.recordedAt),
            }
          : null,
        opportunity,
        lastRefreshedAt,
        degraded,
        matchTier: Number(r.match_tier ?? 1) as 1 | 2 | 3,
        missingCriteria: (r.missing_criteria ?? []) as Array<
          'amount' | 'department' | 'category' | 'closing'
        >,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
      lastRefreshedAt,
      degraded,
      profileExists,
      tierCounts: {
        1: Number(row?.tier_1_count ?? 0),
        2: Number(row?.tier_2_count ?? 0),
        3: Number(row?.tier_3_count ?? 0),
      },
    };
  }

  async recordFeedbackWithWatch(
    id: RecommendationId,
    decision: 'Participate' | 'Discard',
    userId?: UserId,
  ): Promise<Recommendation | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectQuery = userId
        ? `SELECT r.* FROM recommendations r
           JOIN profiles p ON p.id = r.profile_id
           WHERE r.id = $1 AND p.owner_id = $2
           FOR UPDATE OF r;`
        : 'SELECT * FROM recommendations WHERE id = $1 FOR UPDATE;';
      const selectParams = userId ? [id, userId] : [id];

      const findRes: QueryResult<RecommendationRow> = await client.query(
        selectQuery,
        selectParams,
      );

      if (findRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const recRow = findRes.rows[0];

      const updateRes: QueryResult<RecommendationRow> = await client.query(
        `UPDATE recommendations
         SET feedback = jsonb_build_object('decision', $2::text, 'recordedAt', CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *;`,
        [id, decision],
      );

      if (decision === 'Participate') {
        await client.query(
          `INSERT INTO watches (profile_id, opportunity_id, created_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (profile_id, opportunity_id) DO NOTHING;`,
          [recRow.profile_id, recRow.opportunity_id],
        );
      } else if (decision === 'Discard') {
        await client.query(
          `DELETE FROM watches
           WHERE profile_id = $1 AND opportunity_id = $2;`,
          [recRow.profile_id, recRow.opportunity_id],
        );
      }

      await client.query('COMMIT');
      return this.mapRowToEntity(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async clearFeedbackWithWatch(
    id: RecommendationId,
    userId?: UserId,
  ): Promise<Recommendation | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const selectQuery = userId
        ? `SELECT r.* FROM recommendations r
           JOIN profiles p ON p.id = r.profile_id
           WHERE r.id = $1 AND p.owner_id = $2
           FOR UPDATE OF r;`
        : 'SELECT * FROM recommendations WHERE id = $1 FOR UPDATE;';
      const selectParams = userId ? [id, userId] : [id];

      const findRes: QueryResult<RecommendationRow> = await client.query(
        selectQuery,
        selectParams,
      );

      if (findRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }

      const recRow = findRes.rows[0];
      const prevFeedback =
        typeof recRow.feedback === 'string'
          ? JSON.parse(recRow.feedback)
          : recRow.feedback;

      if (prevFeedback?.decision === 'Participate') {
        await client.query(
          `DELETE FROM watches
           WHERE profile_id = $1 AND opportunity_id = $2;`,
          [recRow.profile_id, recRow.opportunity_id],
        );
      }

      const updateRes: QueryResult<RecommendationRow> = await client.query(
        `UPDATE recommendations
         SET feedback = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *;`,
        [id],
      );

      await client.query('COMMIT');
      return this.mapRowToEntity(updateRes.rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private mapOpportunityRow(row: any): Opportunity {
    const analysisRaw =
      typeof row.analysis === 'string'
        ? JSON.parse(row.analysis)
        : row.analysis;
    const changeHistoryRaw =
      typeof row.change_history === 'string'
        ? JSON.parse(row.change_history)
        : row.change_history;

    const amountNum = Number(row.amount);
    const amountKnown = Boolean(row.amount_known ?? true);

    return {
      id: asOpportunityId(row.id),
      title: row.title,
      description: row.description ?? '',
      contractingEntity: {
        name: row.contracting_entity_name,
        taxId: row.contracting_entity_tax_id,
      },
      location: {
        city: row.city ?? '',
        department: row.department ?? '',
      },
      amount: {
        amount: Number.isFinite(amountNum) ? amountNum : 0,
        currency: (row.currency ?? 'COP') as 'COP',
      },
      amountKnown,
      contractType: row.contract_type,
      procurementModality: row.procurement_modality,
      isCompetitive: Boolean(row.is_competitive),
      categoryCode: row.category_code,
      publishedAt: new Date(row.published_at),
      lastPublishedAt: new Date(row.last_published_at ?? row.published_at),
      closingDate: row.closing_date ? new Date(row.closing_date) : null,
      isOpenForSubmission: Boolean(row.is_open_for_submission),
      status: row.status as OpportunityStatus,
      source: {
        sourceName: row.source_name as 'SECOP',
        externalId: row.source_external_id,
        humanReference: row.source_human_reference,
        originalUrl: row.source_original_url,
      },
      analysis: analysisRaw
        ? {
            summary: analysisRaw.summary ?? null,
            summaryStatus: (analysisRaw.summaryStatus ??
              (analysisRaw.summary ? 'ready' : 'unavailable')) as SummaryStatus,
            requirements: Array.isArray(analysisRaw.requirements)
              ? analysisRaw.requirements
              : [],
            embeddingGeneratedAt: analysisRaw.embeddingGeneratedAt
              ? new Date(analysisRaw.embeddingGeneratedAt)
              : null,
          }
        : null,
      changeHistory: Array.isArray(changeHistoryRaw)
        ? changeHistoryRaw.map((ch: any) => ({
            field: ch.field,
            previousValue: ch.previousValue,
            newValue: ch.newValue,
            detectedAt: new Date(ch.detectedAt),
            material: Boolean(ch.material),
          }))
        : [],
    };
  }

  async getProfileEmbedding(
    profileId: ProfileId,
  ): Promise<ProfileEmbeddingRecord | null> {
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
      matchTier: (row.match_tier ? Number(row.match_tier) : 1) as 1 | 2 | 3,
      missingCriteria: (row.missing_criteria ?? []) as Array<
        'amount' | 'department' | 'category' | 'closing'
      >,
    };
  }
}
