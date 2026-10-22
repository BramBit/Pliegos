import { Injectable } from '@nestjs/common';
import { Pool, PoolClient, QueryResult } from 'pg';
import {
  OpportunityRepositoryPort,
  SyncState,
} from '../../../domain/ports/opportunity.repository.port';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { OpportunityId, asOpportunityId } from '../../../../shared/domain/typed-id';
import {
  OpportunityFilters,
  PagedOpportunitiesResult,
} from '../../../domain/value-objects/opportunity-filters';
import { Analysis, OpportunityStatus } from '../../../domain/value-objects/opportunity.value-objects';
import { canonicalizeDepartment } from '../../../../shared/domain/colombian-departments';

export class OpportunityLockBusyError extends Error {
  constructor(public readonly opportunityId: OpportunityId) {
    super(`Advisory lock busy for opportunity ${opportunityId}; will retry`);
    this.name = 'OpportunityLockBusyError';
  }
}

export interface OpportunityRow {
  id: string;
  title: string;
  description: string;
  contracting_entity_name: string;
  contracting_entity_tax_id: string;
  city: string | null;
  department: string | null;
  department_raw?: string | null;
  amount: string | number;
  amount_known: boolean;
  currency: string;
  contract_type: string;
  procurement_modality: string;
  is_competitive: boolean;
  category_code: string | null;
  published_at: Date;
  last_published_at: Date | null;
  closing_date: Date | null;
  is_open_for_submission: boolean;
  status: string;
  source_name: string;
  source_external_id: string;
  source_human_reference: string;
  source_original_url: string;
  analysis: any;
  change_history: any;
}

const UPSERT_OPPORTUNITY_SQL = `
  INSERT INTO opportunities (
    id, title, description, contracting_entity_name, contracting_entity_tax_id, city, department, department_raw,
    amount, amount_known, currency, contract_type, procurement_modality, is_competitive, category_code,
    published_at, last_published_at, closing_date, is_open_for_submission, status,
    source_name, source_external_id, source_human_reference, source_original_url,
    analysis, change_history, updated_at
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE SET
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    contracting_entity_name = EXCLUDED.contracting_entity_name,
    contracting_entity_tax_id = EXCLUDED.contracting_entity_tax_id,
    city = EXCLUDED.city,
    department = EXCLUDED.department,
    department_raw = COALESCE(EXCLUDED.department_raw, opportunities.department_raw),
    amount = EXCLUDED.amount,
    amount_known = EXCLUDED.amount_known,
    currency = EXCLUDED.currency,
    contract_type = EXCLUDED.contract_type,
    procurement_modality = EXCLUDED.procurement_modality,
    is_competitive = EXCLUDED.is_competitive,
    category_code = EXCLUDED.category_code,
    published_at = EXCLUDED.published_at,
    last_published_at = EXCLUDED.last_published_at,
    closing_date = EXCLUDED.closing_date,
    is_open_for_submission = EXCLUDED.is_open_for_submission,
    status = EXCLUDED.status,
    source_name = EXCLUDED.source_name,
    source_external_id = EXCLUDED.source_external_id,
    source_human_reference = EXCLUDED.source_human_reference,
    source_original_url = EXCLUDED.source_original_url,
    analysis = COALESCE(EXCLUDED.analysis, opportunities.analysis),
    change_history = EXCLUDED.change_history,
    updated_at = CURRENT_TIMESTAMP;
`;

@Injectable()
export class PostgresOpportunityRepository implements OpportunityRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(opportunity: Opportunity): Promise<void> {
    await this.pool.query(UPSERT_OPPORTUNITY_SQL, this.toRowValues(opportunity));
  }

  async saveMany(opportunities: Opportunity[]): Promise<void> {
    if (opportunities.length === 0) return;

    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const opportunity of opportunities) {
        await client.query(UPSERT_OPPORTUNITY_SQL, this.toRowValues(opportunity));
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async saveAnalysis(id: OpportunityId, analysis: Analysis): Promise<void> {
    await this.pool.query(
      'UPDATE opportunities SET analysis = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [id, JSON.stringify(analysis)],
    );
  }

  async withAnalysisLock<T>(id: OpportunityId, work: () => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    let acquired = false;
    try {
      const lockRes = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock(hashtext($1)) AS locked',
        [id],
      );
      acquired = Boolean(lockRes.rows[0]?.locked);
      if (!acquired) {
        throw new OpportunityLockBusyError(id);
      }
      return await work();
    } finally {
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(hashtext($1))', [id]);
      }
      client.release();
    }
  }

  private toRowValues(opportunity: Opportunity): unknown[] {
    return [
      opportunity.id,
      opportunity.title,
      opportunity.description,
      opportunity.contractingEntity.name,
      opportunity.contractingEntity.taxId,
      opportunity.location.city,
      opportunity.location.department,
      opportunity.location.departmentRaw ?? opportunity.location.department,
      opportunity.amount.amount,
      opportunity.amountKnown,
      opportunity.amount.currency,
      opportunity.contractType,
      opportunity.procurementModality,
      opportunity.isCompetitive,
      opportunity.categoryCode,
      opportunity.publishedAt,
      opportunity.lastPublishedAt,
      opportunity.closingDate,
      opportunity.isOpenForSubmission,
      opportunity.status,
      opportunity.source.sourceName,
      opportunity.source.externalId,
      opportunity.source.humanReference,
      opportunity.source.originalUrl,
      opportunity.analysis ? JSON.stringify(opportunity.analysis) : null,
      JSON.stringify(opportunity.changeHistory ?? []),
    ];
  }

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    const res: QueryResult<OpportunityRow> = await this.pool.query(
      'SELECT * FROM opportunities WHERE id = $1',
      [id],
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findByExternalId(externalId: string): Promise<Opportunity | null> {
    const res: QueryResult<OpportunityRow> = await this.pool.query(
      'SELECT * FROM opportunities WHERE source_external_id = $1',
      [externalId],
    );

    if (res.rows.length === 0) return null;
    return this.mapRowToEntity(res.rows[0]);
  }

  async findByExternalIds(externalIds: string[]): Promise<Opportunity[]> {
    if (externalIds.length === 0) return [];

    const res: QueryResult<OpportunityRow> = await this.pool.query(
      'SELECT * FROM opportunities WHERE source_external_id = ANY($1::text[])',
      [externalIds],
    );

    return res.rows.map((row) => this.mapRowToEntity(row));
  }

  async getSyncState(source: string): Promise<SyncState | null> {
    const res = await this.pool.query<{
      source: string;
      last_success_at: Date | null;
      watermark: Date | null;
    }>('SELECT source, last_success_at, watermark FROM sync_state WHERE source = $1', [source]);

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      source: row.source,
      lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
      watermark: row.watermark ? new Date(row.watermark) : null,
    };
  }

  async saveSyncState(
    source: string,
    state: { lastSuccessAt: Date; watermark: Date | null },
  ): Promise<void> {
    await this.pool.query(
      `
      INSERT INTO sync_state (source, last_success_at, watermark)
      VALUES ($1, $2, $3)
      ON CONFLICT (source) DO UPDATE SET
        last_success_at = EXCLUDED.last_success_at,
        watermark = COALESCE(
          GREATEST(EXCLUDED.watermark, sync_state.watermark),
          EXCLUDED.watermark,
          sync_state.watermark
        );
      `,
      [source, state.lastSuccessAt, state.watermark],
    );
  }

  private buildWhereClauses(filters: OpportunityFilters, params: unknown[]): string[] {
    const where: string[] = [];

    if (filters.categoryCode && filters.categoryCode.trim() !== '') {
      const rawPrefix = filters.categoryCode.trim();
      const strippedPrefix = rawPrefix.replace(/^v1\./i, '');
      params.push(`${rawPrefix}%`, `${strippedPrefix}%`);
      where.push(
        `(category_code LIKE $${params.length - 1} OR category_code LIKE $${params.length})`,
      );
    }

    if (filters.department && filters.department.trim() !== '') {
      const canonical = canonicalizeDepartment(filters.department.trim());
      params.push(canonical ?? filters.department.trim());
      where.push(`department = $${params.length}`);
    }

    if (filters.contractType && filters.contractType.trim() !== '') {
      params.push(filters.contractType.trim());
      where.push(`contract_type = $${params.length}`);
    }

    if (filters.modality && filters.modality.trim() !== '') {
      params.push(filters.modality.trim());
      where.push(`LOWER(procurement_modality) = LOWER($${params.length})`);
    }

    if (filters.status && filters.status.trim() !== '') {
      params.push(filters.status.trim());
      where.push(`status = $${params.length}`);
    }

    if (filters.closingAfter instanceof Date && !isNaN(filters.closingAfter.getTime())) {
      params.push(filters.closingAfter);
      where.push(`closing_date >= $${params.length}`);
    }

    if (filters.closingBefore instanceof Date && !isNaN(filters.closingBefore.getTime())) {
      params.push(filters.closingBefore);
      where.push(`closing_date <= $${params.length}`);
    }

    if (typeof filters.amountMin === 'number' && Number.isFinite(filters.amountMin)) {
      params.push(filters.amountMin);
      where.push(`amount >= $${params.length}`);
    }

    if (typeof filters.amountMax === 'number' && Number.isFinite(filters.amountMax)) {
      params.push(filters.amountMax);
      where.push(`amount <= $${params.length}`);
    }

    if (filters.actionableOnly) {
      where.push(`status IN ('Published', 'Amended')`);
      where.push('(closing_date IS NULL OR closing_date >= NOW())');
    } else {
      if (filters.onlyCompetitive) {
        where.push(`is_competitive = TRUE`);
      }
      if (filters.onlyOpen) {
        where.push(`status IN ('Published', 'Amended')`);
        where.push('(closing_date IS NULL OR closing_date >= NOW())');
      }
    }

    return where;
  }

  private buildOrderBySql(filters: OpportunityFilters): string {
    const dir = filters.order === 'asc' ? 'ASC' : 'DESC';
    switch (filters.sort) {
      case 'closingDate':
        return `closing_date ${dir} NULLS LAST, id ASC`;
      case 'amount':
        return `amount ${dir}, id ASC`;
      case 'publishedAt':
      default:
        return `published_at ${dir}, id ASC`;
    }
  }

  async findByFilters(filters: OpportunityFilters): Promise<Opportunity[]> {
    const params: unknown[] = [];
    const where = this.buildWhereClauses(filters, params);
    const orderBy = this.buildOrderBySql(filters);
    const limit = Math.min(Math.max(Math.trunc(filters.pageSize ?? filters.limit ?? 100), 1), 1000);

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const query = `SELECT * FROM opportunities ${whereSql} ORDER BY ${orderBy} LIMIT ${limit};`;

    const res: QueryResult<OpportunityRow> = await this.pool.query(query, params);
    return res.rows.map((row) => this.mapRowToEntity(row));
  }

  async findPaged(filters: OpportunityFilters): Promise<PagedOpportunitiesResult> {
    const page = Math.max(1, Math.trunc(filters.page ?? 1));
    const pageSize = Math.min(Math.max(1, Math.trunc(filters.pageSize ?? filters.limit ?? 20)), 50);
    const offset = (page - 1) * pageSize;

    const params: unknown[] = [];
    const where = this.buildWhereClauses(filters, params);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const orderBy = this.buildOrderBySql(filters);

    params.push(pageSize, offset);
    const limitIdx = params.length - 1;
    const offsetIdx = params.length;

    const query = `
      SELECT *, COUNT(*) OVER() AS total_count
      FROM opportunities
      ${whereSql}
      ORDER BY ${orderBy}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const res: QueryResult<OpportunityRow & { total_count: string | number }> =
      await this.pool.query(query, params);

    let total = res.rows.length > 0 ? Number(res.rows[0].total_count) : 0;
    if (res.rows.length === 0 && offset > 0) {
      const countParams = params.slice(0, params.length - 2);
      const countRes = await this.pool.query<{ total_count: string | number }>(
        `SELECT COUNT(*) AS total_count FROM opportunities ${whereSql};`,
        countParams,
      );
      total = Number(countRes.rows[0]?.total_count ?? 0);
    }

    return {
      items: res.rows.map((row) => this.mapRowToEntity(row)),
      total,
      page,
      pageSize,
    };
  }

  private mapRowToEntity(row: OpportunityRow): Opportunity {
    const analysisRaw =
      typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis;
    const changeHistoryRaw =
      typeof row.change_history === 'string'
        ? JSON.parse(change_history_string(row.change_history))
        : row.change_history;
    const publishedAt = new Date(row.published_at);

    return {
      id: asOpportunityId(row.id),
      title: row.title,
      description: row.description ?? '',
      contractingEntity: {
        name: row.contracting_entity_name,
        taxId: row.contracting_entity_tax_id,
      },
      location: {
        city: row.city,
        department: row.department,
        departmentRaw: row.department_raw ?? row.department,
      },
      amount: {
        amount: parseFloat(row.amount.toString()),
        currency: 'COP',
      },
      amountKnown: row.amount_known ?? true,
      contractType: row.contract_type,
      procurementModality: row.procurement_modality,
      isCompetitive: row.is_competitive ?? true,
      categoryCode: row.category_code ?? null,
      publishedAt,
      lastPublishedAt: row.last_published_at ? new Date(row.last_published_at) : publishedAt,
      closingDate: row.closing_date ? new Date(row.closing_date) : null,
      isOpenForSubmission: row.is_open_for_submission,
      status: row.status as OpportunityStatus,
      source: {
        sourceName: 'SECOP',
        externalId: row.source_external_id,
        humanReference: row.source_human_reference,
        originalUrl: row.source_original_url,
      },
      analysis: analysisRaw ?? null,
      changeHistory: Array.isArray(changeHistoryRaw)
        ? changeHistoryRaw.map((ch: any) => ({
            ...ch,
            detectedAt: new Date(ch.detectedAt),
          }))
        : [],
    };
  }
}

function change_history_string(v: string): string {
  return v;
}
