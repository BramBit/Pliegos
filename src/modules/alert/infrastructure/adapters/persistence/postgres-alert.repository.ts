import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import {
  AlertRepositoryPort,
  AlertInboxItem,
  PaginatedAlertInbox,
} from '../../../domain/ports/alert.repository.port';
import { Alert, AlertTrigger } from '../../../domain/entities/alert.entity';
import {
  AlertId,
  ProfileId,
  UserId,
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

interface AlertRow {
  id: string;
  profile_id: string;
  opportunity_id: string;
  trigger: string;
  change_key?: string;
  attempts?: number;
  last_error?: string | null;
  read_at?: Date | null;
  delivered_at: Date | null;
  created_at?: Date | null;
}

@Injectable()
export class PostgresAlertRepository implements AlertRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(alert: Alert): Promise<void> {
    const query = `
      INSERT INTO alerts (id, profile_id, opportunity_id, trigger, change_key, attempts, last_error, read_at, delivered_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        delivered_at = EXCLUDED.delivered_at,
        attempts = EXCLUDED.attempts,
        last_error = EXCLUDED.last_error,
        read_at = EXCLUDED.read_at;
    `;

    const values = [
      alert.id,
      alert.profileId,
      alert.opportunityId,
      alert.trigger,
      alert.changeKey ?? '',
      alert.attempts ?? 0,
      alert.lastError ?? null,
      alert.readAt ?? null,
      alert.deliveredAt,
    ];

    await this.pool.query(query, values);
  }

  async createMany(alerts: Alert[]): Promise<void> {
    if (alerts.length === 0) return;

    const values: any[] = [];
    const valueClauses: string[] = [];

    alerts.forEach((alert, index) => {
      const offset = index * 9;
      valueClauses.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`,
      );
      values.push(
        alert.id,
        alert.profileId,
        alert.opportunityId,
        alert.trigger,
        alert.changeKey ?? '',
        alert.attempts ?? 0,
        alert.lastError ?? null,
        alert.readAt ?? null,
        alert.deliveredAt ?? null,
      );
    });

    const query = `
      INSERT INTO alerts (
        id, profile_id, opportunity_id, trigger, change_key,
        attempts, last_error, read_at, delivered_at
      )
      VALUES ${valueClauses.join(', ')}
      ON CONFLICT DO NOTHING;
    `;

    await this.pool.query(query, values);
  }

  async findUndelivered(limit?: number): Promise<Alert[]> {
    const query = limit
      ? 'SELECT * FROM alerts WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT $1;'
      : 'SELECT * FROM alerts WHERE delivered_at IS NULL ORDER BY created_at ASC;';
    const params = limit ? [limit] : [];
    const res: QueryResult<AlertRow> = await this.pool.query(query, params);

    return res.rows.map((row) => this.mapRowToAlert(row));
  }

  async markFailed(id: AlertId, error: string): Promise<void> {
    await this.pool.query(
      `UPDATE alerts
       SET attempts = attempts + 1,
           last_error = $2
       WHERE id = $1;`,
      [id, error],
    );
  }

  async findById(id: AlertId, userId?: UserId): Promise<Alert | null> {
    const query = userId
      ? `SELECT a.* FROM alerts a
         JOIN profiles p ON p.id = a.profile_id
         WHERE a.id = $1 AND p.owner_id = $2;`
      : 'SELECT * FROM alerts WHERE id = $1;';
    const params = userId ? [id, userId] : [id];
    const res: QueryResult<AlertRow> = await this.pool.query(query, params);
    if (res.rows.length === 0) return null;
    return this.mapRowToAlert(res.rows[0]);
  }

  async findByProfile(
    profileId: ProfileId,
    page: number = 1,
    pageSize: number = 20,
  ): Promise<PaginatedAlertInbox> {
    const safePage = Math.max(1, page);
    const safeSize = Math.max(1, Math.min(100, pageSize));
    const offset = (safePage - 1) * safeSize;

    const countQuery = `SELECT COUNT(*) FROM alerts WHERE profile_id = $1;`;
    const countRes = await this.pool.query<{ count: string }>(countQuery, [
      profileId,
    ]);
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    const query = `
      SELECT
        a.id,
        a.profile_id,
        a.opportunity_id,
        a.trigger,
        a.change_key,
        a.attempts,
        a.last_error,
        a.read_at,
        a.delivered_at,
        a.created_at,
        o.title AS opp_title,
        o.contracting_entity_name AS opp_entity,
        o.amount AS opp_amount,
        o.closing_date AS opp_closing_date
      FROM alerts a
      LEFT JOIN opportunities o ON o.id = a.opportunity_id
      WHERE a.profile_id = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $2 OFFSET $3;
    `;

    const res = await this.pool.query(query, [profileId, safeSize, offset]);

    const items: AlertInboxItem[] = res.rows.map((row) => ({
      id: asAlertId(row.id),
      profileId: asProfileId(row.profile_id),
      opportunityId: asOpportunityId(row.opportunity_id),
      trigger: row.trigger as AlertTrigger,
      changeKey: row.change_key ?? '',
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ?? null,
      readAt: row.read_at ? new Date(row.read_at) : null,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      opportunitySummary: {
        id: row.opportunity_id,
        title: row.opp_title ?? '',
        entity: row.opp_entity ?? '',
        amount: Number(row.opp_amount ?? 0),
        closingDate: row.opp_closing_date
          ? new Date(row.opp_closing_date)
          : null,
      },
    }));

    return {
      items,
      total,
      page: safePage,
      pageSize: safeSize,
    };
  }

  async markRead(id: AlertId): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE alerts
       SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
       WHERE id = $1;`,
      [id],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async markAllRead(profileId: ProfileId): Promise<number> {
    const res = await this.pool.query(
      `UPDATE alerts
       SET read_at = CURRENT_TIMESTAMP
       WHERE profile_id = $1 AND read_at IS NULL;`,
      [profileId],
    );
    return res.rowCount ?? 0;
  }

  private mapRowToAlert(row: AlertRow): Alert {
    return {
      id: asAlertId(row.id),
      profileId: asProfileId(row.profile_id),
      opportunityId: asOpportunityId(row.opportunity_id),
      trigger: row.trigger as AlertTrigger,
      changeKey: row.change_key ?? '',
      attempts: Number(row.attempts ?? 0),
      lastError: row.last_error ?? null,
      readAt: row.read_at ? new Date(row.read_at) : null,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
      createdAt: row.created_at ? new Date(row.created_at) : undefined,
    };
  }
}
