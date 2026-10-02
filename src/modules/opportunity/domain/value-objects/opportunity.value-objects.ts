export * from './money.vo';
export * from './relevance-score.vo';
export * from './opportunity-filters';

export interface Location {
  readonly city: string | null;
  readonly department: string | null;
}

export interface ContractingEntity {
  readonly name: string;
  readonly taxId: string;
}

export interface SourceReference {
  readonly sourceName: 'SECOP';
  readonly externalId: string;         // id_del_proceso
  readonly humanReference: string;     // referencia_del_proceso
  readonly originalUrl: string;        // unwrapped from urlproceso.url
}

export type OpportunityStatus =
  | 'Published'
  | 'Amended'
  | 'Closed'
  | 'Awarded'
  | 'Cancelled'
  | 'Unknown';                         // fallback for unmapped SECOP statuses

export interface Requirement {
  readonly text: string;
  readonly type: 'technical' | 'financial' | 'legal';
}

export interface MatchedFactor {
  readonly factor: 'semanticSimilarity' | 'categoryMatch' | 'amountFit' | 'locationMatch';
  readonly score: number;              // 0..1
  readonly description: string;        // human-readable, e.g. "Coincide con tu categoría de interés"
}

export interface Explanation {
  readonly summary: string;
  readonly matchedFactors: MatchedFactor[];
}

export interface Change {
  readonly field: string;
  readonly previousValue: string;
  readonly newValue: string;
  readonly detectedAt: Date;
}

export type FeedbackDecision = 'Participate' | 'Discard';

export interface Feedback {
  readonly decision: FeedbackDecision;
  readonly recordedAt: Date;
}

export interface Analysis {
  readonly summary: string;
  readonly requirements: Requirement[];
  readonly embeddingGeneratedAt: Date | null;  // null until the queued analysis job runs
}
