import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { AlertRepositoryPort } from '../../../domain/ports/alert.repository.port';
import { Alert, AlertTrigger } from '../../../domain/entities/alert.entity';
import {
  AlertId,
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../../shared/domain/typed-id';

interface AlertRow {
  id: string;
  profile_id: string;
  opportunity_id: string;
  trigger: string;
  delivered_at: Date | null;
}

@Injectable()
export class PostgresAlertRepository implements AlertRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(alert: Alert): Promise<void> {
    const query = `
      INSERT INTO alerts (id, profile_id, opportunity_id, trigger, delivered_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (id) DO UPDATE SET
        delivered_at = EXCLUDED.delivered_at;
    `;

    const values = [
      alert.id,
      alert.profileId,
      alert.opportunityId,
      alert.trigger,
      alert.deliveredAt,
    ];

    await this.pool.query(query, values);
  }

  async findUndelivered(): Promise<Alert[]> {
    const res: QueryResult<AlertRow> = await this.pool.query(
      'SELECT * FROM alerts WHERE delivered_at IS NULL ORDER BY created_at ASC;',
    );

    return res.rows.map((row) => ({
      id: asAlertId(row.id),
      profileId: asProfileId(row.profile_id),
      opportunityId: asOpportunityId(row.opportunity_id),
      trigger: row.trigger as AlertTrigger,
      deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
    }));
  }
}
