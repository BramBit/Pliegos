import { OpportunityId } from '../../../shared/domain/typed-id';
import { Result, ok, err } from '../../../shared/domain/result';
import {
  ValidationError,
  createValidationError,
} from '../../../shared/domain/errors';
import {
  Money,
  Location,
  ContractingEntity,
  SourceReference,
  OpportunityStatus,
  Analysis,
  Change,
} from '../value-objects/opportunity.value-objects';

export interface Opportunity {
  readonly id: OpportunityId;
  readonly title: string;
  readonly description: string;
  readonly contractingEntity: ContractingEntity;
  readonly location: Location;
  readonly amount: Money;
  readonly amountKnown: boolean;
  readonly contractType: string;
  readonly procurementModality: string;
  readonly isCompetitive: boolean;
  readonly categoryCode: string | null; // UNSPSC
  readonly publishedAt: Date;
  readonly lastPublishedAt: Date;
  readonly closingDate: Date | null;
  readonly isOpenForSubmission: boolean;
  readonly status: OpportunityStatus;
  readonly sourceStatus?: string | null;
  readonly source: SourceReference;
  readonly analysis: Analysis | null;
  readonly changeHistory: Change[];
  readonly matchTier?: 1 | 2 | 3;
  readonly missingCriteria?: Array<
    'amount' | 'department' | 'category' | 'closing'
  >;
  readonly statusConfidence?: 'confirmed' | 'unconfirmed';
}

export interface CreateOpportunityProps {
  readonly id: OpportunityId;
  readonly title: string;
  readonly description?: string;
  readonly contractingEntity: ContractingEntity;
  readonly location: Location;
  readonly amount: Money;
  readonly amountKnown?: boolean;
  readonly contractType: string;
  readonly procurementModality: string;
  readonly isCompetitive?: boolean;
  readonly categoryCode: string | null;
  readonly publishedAt: Date;
  readonly lastPublishedAt?: Date;
  readonly closingDate?: Date | null;
  readonly isOpenForSubmission: boolean;
  readonly status: OpportunityStatus;
  readonly sourceStatus?: string | null;
  readonly source: SourceReference;
  readonly analysis?: Analysis | null;
  readonly changeHistory?: Change[];
}

export const createOpportunity = (
  props: CreateOpportunityProps,
): Result<Opportunity, ValidationError> => {
  const missingFields: string[] = [];

  if (!props.id || props.id.trim() === '') {
    missingFields.push('id');
  }
  if (!props.title || props.title.trim() === '') {
    missingFields.push('title');
  }
  if (
    !props.contractingEntity ||
    !props.contractingEntity.name ||
    props.contractingEntity.name.trim() === ''
  ) {
    missingFields.push('contractingEntity.name');
  }
  if (
    !props.source ||
    !props.source.externalId ||
    props.source.externalId.trim() === ''
  ) {
    missingFields.push('source.externalId');
  }
  if (
    !props.publishedAt ||
    !(props.publishedAt instanceof Date) ||
    isNaN(props.publishedAt.getTime())
  ) {
    missingFields.push('publishedAt');
  }

  if (missingFields.length > 0) {
    return err(
      createValidationError(
        missingFields,
        `Cannot create Opportunity: missing or invalid required fields: ${missingFields.join(', ')}`,
      ),
    );
  }

  return ok({
    id: props.id,
    title: props.title,
    description: props.description ?? '',
    contractingEntity: props.contractingEntity,
    location: props.location,
    amount: props.amount,
    amountKnown: props.amountKnown ?? true,
    contractType: props.contractType,
    procurementModality: props.procurementModality,
    isCompetitive: props.isCompetitive ?? true,
    categoryCode:
      props.categoryCode && props.categoryCode.trim() !== ''
        ? props.categoryCode.trim()
        : null,
    publishedAt: props.publishedAt,
    lastPublishedAt: props.lastPublishedAt ?? props.publishedAt,
    closingDate: props.closingDate ?? null,
    isOpenForSubmission: props.isOpenForSubmission,
    status: props.status,
    sourceStatus: props.sourceStatus ?? null,
    source: props.source,
    analysis: props.analysis ?? null,
    changeHistory: props.changeHistory ?? [],
  });
};

export const withOpportunityChange = (
  opportunity: Opportunity,
  change: Change,
): Opportunity => ({
  ...opportunity,
  status: 'Amended',
  changeHistory: [...opportunity.changeHistory, change],
});

export const withOpportunityAnalysis = (
  opportunity: Opportunity,
  analysis: Analysis,
): Opportunity => ({
  ...opportunity,
  analysis,
});

export const MAX_INDEX_DESCRIPTION_LENGTH = 1500;

/**
 * Pure domain function that builds the text to embed for an Opportunity:
 * "{title}. {description truncated to 1500 chars}. Entidad: {entityName}. Tipo: {contractType}."
 * Does NOT include category code, amount, city, department, modality, or LLM summary.
 * If description is empty or equals title (case-insensitive), uses the title only.
 */
export function buildIndexText(
  opportunity: Pick<
    Opportunity,
    'title' | 'description' | 'contractingEntity' | 'contractType'
  >,
): string {
  const title = (opportunity.title ?? '').trim();
  const description = (opportunity.description ?? '').trim();
  const includeDescription =
    description.length > 0 && description.toLowerCase() !== title.toLowerCase();
  const truncatedDescription = includeDescription
    ? description.slice(0, MAX_INDEX_DESCRIPTION_LENGTH)
    : '';

  const lead = truncatedDescription
    ? `${title}. ${truncatedDescription}`
    : title;
  return `${lead}. Entidad: ${opportunity.contractingEntity.name}. Tipo: ${opportunity.contractType}.`;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure domain function determining whether an opportunity is recommendable:
 * isCompetitive AND status IN ('Published', 'Amended') AND (closingDate is null OR closingDate >= now - 7 days).
 */
export function isRecommendable(
  opportunity: Pick<Opportunity, 'isCompetitive' | 'status' | 'closingDate'>,
  now: Date = new Date(),
): boolean {
  if (!opportunity.isCompetitive) {
    return false;
  }
  if (opportunity.status !== 'Published' && opportunity.status !== 'Amended') {
    return false;
  }
  if (opportunity.closingDate === null) {
    return true;
  }
  const threshold = new Date(now.getTime() - SEVEN_DAYS_MS);
  return opportunity.closingDate.getTime() >= threshold.getTime();
}

/**
 * Determines whether an opportunity's analysis has a terminal or generated summary.
 */
export function hasGeneratedSummary(
  analysis: Analysis | null | undefined,
): boolean {
  if (!analysis) return false;
  if (
    analysis.summaryStatus === 'ready' ||
    analysis.summaryStatus === 'fallback'
  ) {
    return true;
  }
  if (!analysis.summaryStatus && Boolean(analysis.summary?.trim())) {
    return true;
  }
  return false;
}
