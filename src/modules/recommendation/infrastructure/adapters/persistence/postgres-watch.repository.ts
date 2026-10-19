import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  WatchRepositoryPort,
  PagedWatchedOpportunities,
  ProfileSummary,
  WatchedOpportunityItem,
  WatcherProfile,
} from '../../../domain/ports/watch.repository.port';
import { ProfileId, OpportunityId, UserId, asOpportunityId, asProfileId } from '../../../../shared/domain/typed-id';
import { Opportunity } from '../../../../opportunity/domain/entities/opportunity.entity';
import {
  OpportunityStatus,
  SummaryStatus,
  Change,
} from '../../../../opportunity/domain/value-objects/opportunity.value-objects';

interface WatchedRow {
  added_at: Date | string;
  total_count: string | number;
  id: string;
  title: string;
  description: string;
  contracting_entity_name: string;
  contracting_entity_tax_id: string;
  city: string | null;
  department: string | null;
  amount: string | number;
  amount_known: boolean;
  currency: string;
  contract_type: string;
  procurement_modality: string;
  is_competitive: boolean;
  category_code: string;
  published_at: Date | string;
  last_published_at: Date | string;
  closing_date: Date | string | null;
  is_open_for_submission: boolean;
  status: string;
  source_name: string;
  source_external_id: string;
  source_human_reference: string;
  source_original_url: string;
  analysis: any;
  change_history: any;
}

@Injectable()
export class PostgresWatchRepository implements WatchRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async addWatch(
    profileId: ProfileId,
    opportunityId: OpportunityId,
    userId?: UserId,
  ): Promise<void> {
    const query = userId
      ? `INSERT INTO watches (profile_id, opportunity_id, created_at)
         SELECT p.id, $2, CURRENT_TIMESTAMP
         FROM profiles p
         WHERE p.id = $1 AND p.owner_id = $3
         ON CONFLICT (profile_id, opportunity_id) DO NOTHING;`
      : `INSERT INTO watches (profile_id, opportunity_id, created_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (profile_id, opportunity_id) DO NOTHING;`;
    const params = userId ? [profileId, opportunityId, userId] : [profileId, opportunityId];
    await this.pool.query(query, params);
  }

  async removeWatch(
    profileId: ProfileId,
    opportunityId: OpportunityId,
    userId?: UserId,
  ): Promise<boolean> {
    const query = userId
      ? `DELETE FROM watches w
         USING profiles p
         WHERE w.profile_id = p.id
           AND p.id = $1
           AND p.owner_id = $2
           AND w.opportunity_id = $3;`
      : `DELETE FROM watches
         WHERE profile_id = $1 AND opportunity_id = $2;`;
    const params = userId ? [profileId, userId, opportunityId] : [profileId, opportunityId];
    const res = await this.pool.query(query, params);
    return (res.rowCount ?? 0) > 0;
  }

  async isWatching(
    profileId: ProfileId,
    opportunityId: OpportunityId,
    userId?: UserId,
  ): Promise<boolean> {
    const query = userId
      ? `SELECT 1 FROM watches w
         JOIN profiles p ON p.id = w.profile_id
         WHERE w.profile_id = $1 AND p.owner_id = $2 AND w.opportunity_id = $3;`
      : `SELECT 1 FROM watches
         WHERE profile_id = $1 AND opportunity_id = $2;`;
    const params = userId ? [profileId, userId, opportunityId] : [profileId, opportunityId];
    const res = await this.pool.query(query, params);
    return res.rows.length > 0;
  }

  async findWatchedPaged(
    profileId: ProfileId,
    page: number = 1,
    pageSize: number = 20,
    userId?: UserId,
  ): Promise<PagedWatchedOpportunities> {
    const safePage = Math.max(1, Math.trunc(page));
    const safeSize = Math.min(50, Math.max(1, Math.trunc(pageSize)));
    const offset = (safePage - 1) * safeSize;

    const query = `
      SELECT
        w.created_at AS added_at,
        o.*,
        COUNT(*) OVER() AS total_count
      FROM watches w
      JOIN opportunities o ON o.id = w.opportunity_id
      JOIN profiles p ON p.id = w.profile_id
      WHERE w.profile_id = $1 AND ($4::text IS NULL OR p.owner_id = $4)
      ORDER BY w.created_at DESC
      LIMIT $2 OFFSET $3;
    `;

    const res: QueryResult<WatchedRow> = await this.pool.query(query, [
      profileId,
      safeSize,
      offset,
      userId ?? null,
    ]);

    let total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    if (res.rows.length === 0 && offset > 0) {
      const countRes = await this.pool.query<{ count: string | number }>(
        `SELECT COUNT(*) AS count
         FROM watches w
         JOIN profiles p ON p.id = w.profile_id
         WHERE w.profile_id = $1 AND ($2::text IS NULL OR p.owner_id = $2);`,
        [profileId, userId ?? null],
      );
      total = Number(countRes.rows[0]?.count ?? 0);
    }

    const items: WatchedOpportunityItem[] = res.rows.map((row) => {
      const opportunity = this.mapRowToOpportunity(row);
      const last10Changes = opportunity.changeHistory.slice(-10);
      return {
        opportunity,
        last10Changes,
        addedAt: new Date(row.added_at),
      };
    });

    return {
      items,
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }

  async getProfileSummary(profileId: ProfileId, userId?: UserId): Promise<ProfileSummary | null> {
    const query = `
      SELECT
        (EXISTS(SELECT 1 FROM profiles WHERE id = $1 AND ($2::text IS NULL OR owner_id = $2))) AS profile_exists,
        (SELECT COUNT(*)
         FROM recommendations r
         JOIN profiles p ON p.id = r.profile_id
         WHERE r.profile_id = $1
           AND ($2::text IS NULL OR p.owner_id = $2)
           AND r.feedback IS NULL) AS new_recommendations,
        (SELECT COUNT(*)
         FROM watches w
         JOIN profiles p ON p.id = w.profile_id
         WHERE w.profile_id = $1
           AND ($2::text IS NULL OR p.owner_id = $2)) AS watching,
        (SELECT COUNT(*)
         FROM watches w
         JOIN opportunities o ON o.id = w.opportunity_id
         JOIN profiles p ON p.id = w.profile_id
         WHERE w.profile_id = $1
           AND ($2::text IS NULL OR p.owner_id = $2)
           AND o.closing_date IS NOT NULL
           AND o.closing_date >= CURRENT_TIMESTAMP
           AND o.closing_date <= CURRENT_TIMESTAMP + interval '7 days') AS closing_soon,
        0 AS unread_alerts;
    `;

    const res = await this.pool.query<{
      profile_exists: boolean;
      new_recommendations: string | number;
      watching: string | number;
      closing_soon: string | number;
      unread_alerts: string | number;
    }>(query, [profileId, userId ?? null]);

    const row = res.rows[0];
    if (!row || !row.profile_exists) {
      return null;
    }

    return {
      newRecommendations: Number(row.new_recommendations ?? 0),
      watching: Number(row.watching ?? 0),
      closingSoon: Number(row.closing_soon ?? 0),
      unreadAlerts: Number(row.unread_alerts ?? 0),
    };
  }

  async findWatchers(opportunityId: OpportunityId): Promise<WatcherProfile[]> {
    const query = `
      SELECT w.profile_id, p.alerts_enabled, p.contact_email
      FROM watches w
      JOIN profiles p ON p.id = w.profile_id
      WHERE w.opportunity_id = $1
      ORDER BY w.created_at ASC;
    `;
    const res = await this.pool.query(query, [opportunityId]);
    return res.rows.map((row) => ({
      profileId: asProfileId(row.profile_id),
      alertsEnabled: Boolean(row.alerts_enabled ?? true),
      contactEmail: row.contact_email ?? null,
    }));
  }

  private mapRowToOpportunity(row: WatchedRow): Opportunity {
    const analysisRaw =
      typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis;
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
            requirements: Array.isArray(analysisRaw.requirements) ? analysisRaw.requirements : [],
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
}
