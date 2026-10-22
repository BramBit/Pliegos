export * from './money.vo';
export * from './relevance-score.vo';
export * from './opportunity-filters';

/**
 * Normalizes a UNSPSC category code: strips the 'V1.' prefix. Returns null for
 * absent values, 'UNSPECIFIED' and all-zero codes such as '00000000'.
 */
export function normalizeUnspsc(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  const code = trimmed.replace(/^v1\./i, '');
  if (code === '' || code.toUpperCase() === 'UNSPECIFIED') return null;
  if (/^0+$/.test(code)) return null;
  return code;
}

export interface Location {
  readonly city: string | null;
  readonly department: string | null;
  readonly departmentRaw?: string | null;
}

export interface ContractingEntity {
  readonly name: string;
  readonly taxId: string;
}

export interface SourceReference {
  readonly sourceName: 'SECOP';
  readonly externalId: string; // id_del_proceso
  readonly humanReference: string; // referencia_del_proceso
  readonly originalUrl: string; // unwrapped from urlproceso.url
}

export type OpportunityStatus =
  | 'Draft'
  | 'Published'
  | 'Amended'
  | 'Closed'
  | 'Awarded'
  | 'Cancelled'
  | 'Unknown'; // fallback for unmapped SECOP statuses

export interface Requirement {
  readonly text: string;
  readonly type: 'technical' | 'financial' | 'legal';
}

export interface MatchedFactor {
  readonly factor:
    'semanticSimilarity' | 'categoryMatch' | 'amountFit' | 'locationMatch';
  readonly score: number; // 0..1
  readonly description: string; // human-readable, e.g. "Coincide con tu categoría de interés"
}

export interface Explanation {
  readonly summary: string;
  readonly matchedFactors: MatchedFactor[];
  readonly unavailableFactors?: string[];
}

export interface Change {
  readonly field: string;
  readonly previousValue: string;
  readonly newValue: string;
  readonly detectedAt: Date;
  readonly material?: boolean;
}

export type FeedbackDecision = 'Participate' | 'Discard';

export interface Feedback {
  readonly decision: FeedbackDecision;
  readonly recordedAt: Date;
}

export type SummaryStatus = 'pending' | 'ready' | 'fallback' | 'unavailable';

export interface Analysis {
  readonly summary: string;
  readonly summaryStatus?: SummaryStatus;
  readonly requirements: Requirement[];
  readonly embeddingGeneratedAt: Date | null; // null until the queued analysis job runs
  readonly contentHash?: string;
}
