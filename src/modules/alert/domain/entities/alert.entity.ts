import {
  AlertId,
  ProfileId,
  OpportunityId,
} from '../../../shared/domain/typed-id';
import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';

export type AlertTrigger = 'Amendment' | 'DeadlineApproaching' | 'StatusChange';

export interface Alert {
  readonly id: AlertId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly trigger: AlertTrigger;
  readonly changeKey: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly readAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt?: Date;
}

export interface CreateAlertProps {
  readonly id: AlertId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly trigger: AlertTrigger;
  readonly changeKey?: string;
  readonly attempts?: number;
  readonly lastError?: string | null;
  readonly readAt?: Date | null;
  readonly deliveredAt?: Date | null;
  readonly createdAt?: Date;
}

export const createAlert = (props: CreateAlertProps): Result<Alert, ValidationError> => {
  const missingFields: string[] = [];

  if (!props.id || props.id.trim() === '') {
    missingFields.push('id');
  }
  if (!props.profileId || props.profileId.trim() === '') {
    missingFields.push('profileId');
  }
  if (!props.opportunityId || props.opportunityId.trim() === '') {
    missingFields.push('opportunityId');
  }
  if (!props.trigger) {
    missingFields.push('trigger');
  }

  if (missingFields.length > 0) {
    return err(
      createValidationError(
        missingFields,
        `Cannot create Alert: missing required fields: ${missingFields.join(', ')}`,
      ),
    );
  }

  return ok({
    id: props.id,
    profileId: props.profileId,
    opportunityId: props.opportunityId,
    trigger: props.trigger,
    changeKey: props.changeKey ?? '',
    attempts: props.attempts ?? 0,
    lastError: props.lastError ?? null,
    readAt: props.readAt ?? null,
    deliveredAt: props.deliveredAt ?? null,
    createdAt: props.createdAt,
  });
};

export const markAlertDelivered = (alert: Alert, deliveredAt: Date = new Date()): Alert => ({
  ...alert,
  deliveredAt,
});
