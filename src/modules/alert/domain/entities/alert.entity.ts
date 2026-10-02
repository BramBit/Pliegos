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
  readonly deliveredAt: Date | null;
}

export interface CreateAlertProps {
  readonly id: AlertId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly trigger: AlertTrigger;
  readonly deliveredAt?: Date | null;
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
    deliveredAt: props.deliveredAt ?? null,
  });
};

export const markAlertDelivered = (alert: Alert, deliveredAt: Date = new Date()): Alert => ({
  ...alert,
  deliveredAt,
});
