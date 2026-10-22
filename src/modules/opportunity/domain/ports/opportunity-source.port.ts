import { OpportunityStatus } from '../value-objects/opportunity.value-objects';

export interface SourceOpportunity {
  readonly externalId: string;
  readonly humanReference: string;
  readonly title: string;
  readonly description: string;
  readonly entityName: string;
  readonly entityTaxId: string;
  readonly city: string | null;
  readonly department: string | null;
  readonly departmentRaw?: string | null;
  readonly amount: number | null;
  readonly contractType: string;
  readonly procurementModality: string;
  readonly isCompetitive: boolean;
  readonly categoryCode: string | null;
  readonly publishedAt: Date;
  readonly lastPublishedAt: Date;
  readonly closingDate: Date | null;
  readonly isOpenForSubmission: boolean;
  readonly status: OpportunityStatus;
  readonly sourceStatus?: string | null;
  readonly originalUrl: string;
}

export type SourceFetchMode = 'incremental' | 'openCompetitive';

export interface SourceFetchOptions {
  readonly pageSize?: number;
  readonly maxRecords?: number;
  readonly mode?: SourceFetchMode;
  readonly now?: Date;
  readonly onSkipped?: () => void;
  readonly onUnknownStatus?: (rawStatus: string) => void;
}

export interface OpportunitySourcePort {
  fetchPages(
    since?: Date,
    options?: SourceFetchOptions,
  ): AsyncIterable<SourceOpportunity[]>;
}

export const OPPORTUNITY_SOURCE_PORT = Symbol('OPPORTUNITY_SOURCE_PORT');
