import { Opportunity } from '../entities/opportunity.entity';
import { OpportunityId } from '../../../shared/domain/typed-id';
import { OpportunityFilters } from '../value-objects/opportunity-filters';

export interface CandidateRetrievalQuery {
  readonly text: string;
  readonly vector: number[];
  readonly mode?: 'profile' | 'user';
}

import { OpportunityStatus } from '../value-objects/opportunity.value-objects';

export interface CandidateRetrievalFilters {
  readonly onlyCompetitive?: boolean;
  readonly onlyOpen?: boolean;
  readonly actionable?: boolean;
  readonly hardExclusionsOnly?: boolean;
  readonly department?: string;
  readonly categoryCode?: string;
  readonly contractType?: string;
  readonly modality?: string;
  readonly status?: OpportunityStatus;
  readonly closingAfter?: Date;
  readonly closingBefore?: Date;
  readonly amountMin?: number;
  readonly amountMax?: number;
}

export interface RetrievedCandidateItem {
  readonly id: OpportunityId;
  readonly cosine: number | null;
  readonly textRank: number | null;
  readonly fusedScore: number;
}

export type RetrievalLevel = 'hybrid' | 'vector' | 'fulltext';

export interface CandidateRetrievalResult {
  readonly items: RetrievedCandidateItem[];
  readonly level: RetrievalLevel;
  readonly degraded: boolean;
}

export interface SearchIndexPort {
  indexOpportunity(opportunity: Opportunity): Promise<void>;
  semanticSearch(
    queryVector: number[],
    filters: OpportunityFilters,
  ): Promise<OpportunityId[]>;
  similarities(
    profileVector: number[],
    opportunityIds: OpportunityId[],
  ): Promise<Map<OpportunityId, number>>;
  retrieveCandidates(
    query: CandidateRetrievalQuery,
    filters: CandidateRetrievalFilters,
    limit: number,
  ): Promise<CandidateRetrievalResult>;
}

export const SEARCH_INDEX_PORT = Symbol('SEARCH_INDEX_PORT');

export interface RrfScoredItem<Id extends string = string> {
  readonly id: Id;
  readonly fusedScore: number;
}

const SPANISH_STOPWORDS = new Set([
  'de',
  'la',
  'el',
  'en',
  'un',
  'una',
  'los',
  'las',
  'del',
  'al',
  'por',
  'con',
  'para',
  'sin',
  'sobre',
  'entre',
  'hacia',
  'hasta',
  'desde',
  'como',
  'mas',
  'pero',
  'sus',
  'les',
  'que',
  'es',
  'son',
  'fue',
]);

/**
 * Pure domain function implementing Reciprocal Rank Fusion (RRF):
 * score(id) = sum over lists of 1 / (k + rank + 1), with rank starting at 0.
 * Sorts descending by fusedScore and optionally slices to limit.
 */
export function reciprocalRankFusion<Id extends string = string>(
  lists: readonly (readonly { id: Id }[])[],
  k: number = 60,
  limit?: number,
): RrfScoredItem<Id>[] {
  const scores = new Map<Id, number>();

  for (const list of lists) {
    const seenInList = new Set<Id>();
    for (let rank = 0; rank < list.length; rank++) {
      const id = list[rank].id;
      if (seenInList.has(id)) continue;
      seenInList.add(id);
      const prev = scores.get(id) ?? 0;
      scores.set(id, prev + 1 / (k + rank + 1));
    }
  }

  const ranked: RrfScoredItem<Id>[] = Array.from(scores.entries()).map(
    ([id, fusedScore]) => ({
      id,
      fusedScore,
    }),
  );

  ranked.sort((a, b) => b.fusedScore - a.fusedScore);

  return limit !== undefined ? ranked.slice(0, limit) : ranked;
}

/**
 * Builds an OR tsquery expression ('a | b | c') from up to 20 sanitized keyword terms
 * (letters and digits only) for profile full-text retrieval.
 */
export function buildProfileOrTsQuery(
  textOrTerms: string | readonly string[],
  maxTerms = 20,
): string {
  const rawSource = Array.isArray(textOrTerms)
    ? textOrTerms.join(' ')
    : String(textOrTerms ?? '');
  const matches = rawSource.match(/[\p{L}\p{N}]+/gu) ?? [];

  const uniqueTerms: string[] = [];
  const seen = new Set<string>();

  for (const token of matches) {
    const cleaned = token.trim();
    if (cleaned.length < 2) continue;
    const lower = cleaned
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    if (SPANISH_STOPWORDS.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    uniqueTerms.push(cleaned);
    if (uniqueTerms.length >= maxTerms) break;
  }

  return uniqueTerms.join(' | ');
}
