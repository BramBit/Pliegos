import { Injectable } from '@nestjs/common';
import { Pool, QueryResult } from 'pg';
import { OpportunityRepositoryPort } from '../../../domain/ports/opportunity.repository.port';
import { Opportunity } from '../../../domain/entities/opportunity.entity';
import { OpportunityId, asOpportunityId } from '../../../../shared/domain/typed-id';
import { OpportunityFilters } from '../../../domain/value-objects/opportunity-filters';
import { OpportunityStatus } from '../../../domain/value-objects/opportunity.value-objects';

export interface OpportunityRow {
  id: string;
  title: string;
  contracting_entity_name: string;
  contracting_entity_tax_id: string;
  city: string | null;
  department: string | null;
  amount: string | number;
  currency: string;
  contract_type: string;
  procurement_modality: string;
  category_code: string;
  published_at: Date;
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

@Injectable()
export class PostgresOpportunityRepository implements OpportunityRepositoryPort {
  constructor(private readonly pool: Pool) {}

  async save(opportunity: Opportunity): Promise<void> {
    const query = `
      INSERT INTO opportunities (
        id, title, contracting_entity_name, contracting_entity_tax_id, city, department,
        amount, currency, contract_type, procurement_modality, category_code,
        published_at, closing_date, is_open_for_submission, status,
        source_name, source_external_id, source_human_reference, source_original_url,
        analysis, change_history, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, CURRENT_TIMESTAMP
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        contracting_entity_name = EXCLUDED.contracting_entity_name,
        contracting_entity_tax_id = EXCLUDED.contracting_entity_tax_id,
        city = EXCLUDED.city,
        department = EXCLUDED.department,
        amount = EXCLUDED.amount,
        currency = EXCLUDED.currency,
        contract_type = EXCLUDED.contract_type,
        procurement_modality = EXCLUDED.procurement_modality,
        category_code = EXCLUDED.category_code,
        published_at = EXCLUDED.published_at,
        closing_date = EXCLUDED.closing_date,
        is_open_for_submission = EXCLUDED.is_open_for_submission,
        status = EXCLUDED.status,
        source_name = EXCLUDED.source_name,
        source_external_id = EXCLUDED.source_external_id,
        source_human_reference = EXCLUDED.source_human_reference,
        source_original_url = EXCLUDED.source_original_url,
        analysis = EXCLUDED.analysis,
        change_history = EXCLUDED.change_history,
        updated_at = CURRENT_TIMESTAMP;
    `;

    const values = [
      opportunity.id,
      opportunity.title,
      opportunity.contractingEntity.name,
      opportunity.contractingEntity.taxId,
      opportunity.location.city,
      opportunity.location.department,
      opportunity.amount.amount,
      opportunity.amount.currency,
      opportunity.contractType,
      opportunity.procurementModality,
      opportunity.categoryCode,
      opportunity.publishedAt,
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

    await this.pool.query(query, values);
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

  async findByFilters(filters: OpportunityFilters): Promise<Opportunity[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (filters.categoryCode && filters.categoryCode.trim() !== '') {
      params.push(`${filters.categoryCode.trim()}%`);
      where.push(`category_code LIKE $${params.length}`);
    }

    if (filters.department && filters.department.trim() !== '') {
      params.push(filters.department.trim());
      where.push(`department = $${params.length}`);
    }

    if (filters.contractType && filters.contractType.trim() !== '') {
      params.push(filters.contractType.trim());
      where.push(`contract_type = $${params.length}`);
    }

    if (typeof filters.amountMin === 'number' && Number.isFinite(filters.amountMin)) {
      params.push(filters.amountMin);
      where.push(`amount >= $${params.length}`);
    }

    if (typeof filters.amountMax === 'number' && Number.isFinite(filters.amountMax)) {
      params.push(filters.amountMax);
      where.push(`amount <= $${params.length}`);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const query = `SELECT * FROM opportunities ${whereSql} ORDER BY published_at DESC LIMIT 100;`;

    const res: QueryResult<OpportunityRow> = await this.pool.query(query, params);
    return res.rows.map((row) => this.mapRowToEntity(row));
  }

  private mapRowToEntity(row: OpportunityRow): Opportunity {
    const analysisRaw =
      typeof row.analysis === 'string' ? JSON.parse(row.analysis) : row.analysis;
    const changeHistoryRaw =
      typeof row.change_history === 'string'
        ? JSON.parse(row.change_history)
        : row.change_history;

    return {
      id: asOpportunityId(row.id),
      title: row.title,
      contractingEntity: {
        name: row.contracting_entity_name,
        taxId: row.contracting_entity_tax_id,
      },
      location: {
        city: row.city,
        department: row.department,
      },
      amount: {
        amount: parseFloat(row.amount.toString()),
        currency: 'COP',
      },
      contractType: row.contract_type,
      procurementModality: row.procurement_modality,
      categoryCode: row.category_code,
      publishedAt: new Date(row.published_at),
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
