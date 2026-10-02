import { OpportunityId } from '../../../shared/domain/typed-id';
import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';
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
  readonly contractingEntity: ContractingEntity;
  readonly location: Location;
  readonly amount: Money;
  readonly contractType: string;
  readonly procurementModality: string;
  readonly categoryCode: string; // UNSPSC
  readonly publishedAt: Date;
  readonly closingDate: Date | null;
  readonly isOpenForSubmission: boolean;
  readonly status: OpportunityStatus;
  readonly source: SourceReference;
  readonly analysis: Analysis | null;
  readonly changeHistory: Change[];
}

export interface CreateOpportunityProps {
  readonly id: OpportunityId;
  readonly title: string;
  readonly contractingEntity: ContractingEntity;
  readonly location: Location;
  readonly amount: Money;
  readonly contractType: string;
  readonly procurementModality: string;
  readonly categoryCode: string;
  readonly publishedAt: Date;
  readonly closingDate?: Date | null;
  readonly isOpenForSubmission: boolean;
  readonly status: OpportunityStatus;
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
  if (!props.contractingEntity || !props.contractingEntity.name || props.contractingEntity.name.trim() === '') {
    missingFields.push('contractingEntity.name');
  }
  if (!props.categoryCode || props.categoryCode.trim() === '') {
    missingFields.push('categoryCode');
  }
  if (!props.source || !props.source.externalId || props.source.externalId.trim() === '') {
    missingFields.push('source.externalId');
  }
  if (!props.publishedAt || !(props.publishedAt instanceof Date) || isNaN(props.publishedAt.getTime())) {
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
    contractingEntity: props.contractingEntity,
    location: props.location,
    amount: props.amount,
    contractType: props.contractType,
    procurementModality: props.procurementModality,
    categoryCode: props.categoryCode,
    publishedAt: props.publishedAt,
    closingDate: props.closingDate ?? null,
    isOpenForSubmission: props.isOpenForSubmission,
    status: props.status,
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
