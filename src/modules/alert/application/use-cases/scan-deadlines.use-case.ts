import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  LoggerService,
  Optional,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DATABASE_POOL } from '../../../shared/infrastructure/persistence/database.module';
import {
  ALERT_REPOSITORY_PORT,
  AlertRepositoryPort,
} from '../../domain/ports/alert.repository.port';
import { Alert, createAlert } from '../../domain/entities/alert.entity';
import {
  asAlertId,
  asOpportunityId,
  asProfileId,
} from '../../../shared/domain/typed-id';
import { Clock, CLOCK_PORT, SystemClock } from '../../../shared/domain/clock';
import { Result, ok, err } from '../../../shared/domain/result';

export interface ScanDeadlinesResult {
  alertsCreated: number;
  skipped?: boolean;
  reason?: string;
}

interface DeadlineRow {
  profile_id: string;
  opportunity_id: string;
  closing_date: Date | string;
}

export function formatClosingDateKey(date: Date): string {
  const iso = date.toISOString();
  return `deadline:${iso.slice(0, 10)}`;
}

@Injectable()
export class ScanDeadlinesUseCase {
  private readonly logger: LoggerService;

  constructor(
    @Inject(DATABASE_POOL)
    private readonly pool: Pool,
    @Inject(ALERT_REPOSITORY_PORT)
    private readonly alertRepo: AlertRepositoryPort,
    @Optional()
    @Inject(CLOCK_PORT)
    private readonly clock: Clock = new SystemClock(),
    logger?: LoggerService,
    private readonly recommendDeadlineAlerts: boolean = false,
  ) {
    this.logger = logger ?? new Logger(ScanDeadlinesUseCase.name);
  }

  async execute(): Promise<Result<ScanDeadlinesResult, Error>> {
    const client: PoolClient = await this.pool.connect();
    let acquired = false;

    try {
      const lockRes = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtext('scan-deadlines')) AS locked",
      );
      acquired = Boolean(lockRes.rows[0]?.locked);

      if (!acquired) {
        this.logger.warn('ScanDeadlines: advisory lock is busy, skipping run');
        return ok({ alertsCreated: 0, skipped: true, reason: 'lock_busy' });
      }

      const now = this.clock.now();

      // 1. Watched opportunities closing between now and now + profile.deadline_alert_days
      const watchedQuery = `
        SELECT
          w.profile_id,
          w.opportunity_id,
          o.closing_date
        FROM watches w
        JOIN profiles p ON p.id = w.profile_id
        JOIN opportunities o ON o.id = w.opportunity_id
        WHERE p.alerts_enabled = true
          AND o.closing_date IS NOT NULL
          AND o.closing_date >= $1
          AND (o.closing_date AT TIME ZONE 'UTC')::date <= (($1 AT TIME ZONE 'UTC')::date + COALESCE(p.deadline_alert_days, 3))
          AND NOT EXISTS (
            SELECT 1 FROM alerts a
            WHERE a.profile_id = w.profile_id
              AND a.opportunity_id = w.opportunity_id
              AND a.trigger = 'DeadlineApproaching'
              AND a.change_key = 'deadline:' || to_char(o.closing_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          );
      `;
      const watchedRes = await client.query<DeadlineRow>(watchedQuery, [now]);
      const candidateRows: DeadlineRow[] = [...watchedRes.rows];

      // 2. Optional: top 5 new recommendations closing within 3 days
      const recommendDeadlineAlerts = this.recommendDeadlineAlerts;
      if (recommendDeadlineAlerts) {
        const recommendationsQuery = `
          SELECT
            sub.profile_id,
            sub.opportunity_id,
            sub.closing_date
          FROM (
            SELECT
              r.profile_id,
              r.opportunity_id,
              o.closing_date,
              r.score,
              ROW_NUMBER() OVER (PARTITION BY r.profile_id ORDER BY r.score DESC) as rn
            FROM recommendations r
            JOIN profiles p ON p.id = r.profile_id
            JOIN opportunities o ON o.id = r.opportunity_id
            WHERE p.alerts_enabled = true
              AND r.feedback IS NULL
              AND o.closing_date IS NOT NULL
              AND o.closing_date >= $1
              AND (o.closing_date AT TIME ZONE 'UTC')::date <= (($1 AT TIME ZONE 'UTC')::date + 3)
              AND NOT EXISTS (
                SELECT 1 FROM alerts a
                WHERE a.profile_id = r.profile_id
                  AND a.opportunity_id = r.opportunity_id
                  AND a.trigger = 'DeadlineApproaching'
                  AND a.change_key = 'deadline:' || to_char(o.closing_date AT TIME ZONE 'UTC', 'YYYY-MM-DD')
              )
          ) sub
          WHERE sub.rn <= 5;
        `;
        const recRes = await client.query<DeadlineRow>(recommendationsQuery, [
          now,
        ]);
        candidateRows.push(...recRes.rows);
      }

      // 3. Assemble and deduplicate alerts
      const seenKeys = new Set<string>();
      const alertsToCreate: Alert[] = [];

      for (const row of candidateRows) {
        const closingDate =
          row.closing_date instanceof Date
            ? row.closing_date
            : new Date(row.closing_date);
        const changeKey = formatClosingDateKey(closingDate);
        const dedupKey = `${row.profile_id}:${row.opportunity_id}:${changeKey}`;

        if (seenKeys.has(dedupKey)) {
          continue;
        }
        seenKeys.add(dedupKey);

        const alertRes = createAlert({
          id: asAlertId(randomUUID()),
          profileId: asProfileId(row.profile_id),
          opportunityId: asOpportunityId(row.opportunity_id),
          trigger: 'DeadlineApproaching',
          changeKey,
        });

        if (alertRes.ok) {
          alertsToCreate.push(alertRes.value);
        }
      }

      if (alertsToCreate.length > 0) {
        await this.alertRepo.createMany(alertsToCreate);
      }

      this.logger.log(
        `ScanDeadlines: finished scanning, created ${alertsToCreate.length} DeadlineApproaching alerts`,
      );

      return ok({ alertsCreated: alertsToCreate.length });
    } catch (error) {
      const errObj = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `ScanDeadlines failed: ${errObj.message}`,
        errObj.stack,
      );
      return err(errObj);
    } finally {
      if (acquired) {
        try {
          await client.query(
            "SELECT pg_advisory_unlock(hashtext('scan-deadlines'))",
          );
        } catch (unlockErr) {
          const msg =
            unlockErr instanceof Error ? unlockErr.message : String(unlockErr);
          this.logger.error(`ScanDeadlines unlock failed: ${msg}`);
        }
      }
      client.release();
    }
  }
}
