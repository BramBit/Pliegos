import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { RecommendationRepositoryPort } from '../../../domain/ports/recommendation.repository.port';
import { Recommendation } from '../../../domain/entities/recommendation.entity';
import {
  RecommendationId,
  ProfileId,
  asRecommendationId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

interface RecommendationRow {
  id: string;
  profile_id: string;
  opportunity_id: string;
  score: string | number;
  explanation: any;
  feedback: any;
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

  async findByProfile(profileId: ProfileId): Promise<Recommendation[]> {
    const res: QueryResult<RecommendationRow> = await this.pool.query(
      'SELECT * FROM recommendations WHERE profile_id = $1 ORDER BY score DESC;',
      [profileId],
    );

    return res.rows.map((row) => this.mapRowToEntity(row));
  }

  async findById(id: RecommendationId): Promise<Recommendation | null> {
    const res: QueryResult<RecommendationRow> = await this.pool.query(
      'SELECT * FROM recommendations WHERE id = $1;',
      [id],
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
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
