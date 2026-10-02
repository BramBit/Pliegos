import { ProfileId, UserId } from '../../../shared/domain/typed-id';
import { Capability, ProfilePreferences } from '../value-objects/profile.value-objects';
import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';

export interface Profile {
  readonly id: ProfileId;
  readonly ownerId: UserId;
  readonly sector: string;
  readonly capabilities: Capability[];
  readonly preferences: ProfilePreferences;
}

export interface CreateProfileProps {
  readonly id: ProfileId;
  readonly ownerId: UserId;
  readonly sector: string;
  readonly capabilities?: Capability[];
  readonly preferences: ProfilePreferences;
}

export const createProfile = (props: CreateProfileProps): Result<Profile, ValidationError> => {
  const missingFields: string[] = [];

  if (!props.id || props.id.trim() === '') {
    missingFields.push('id');
  }
  if (!props.ownerId || props.ownerId.trim() === '') {
    missingFields.push('ownerId');
  }
  if (!props.sector || props.sector.trim() === '') {
    missingFields.push('sector');
  }
  if (!props.preferences) {
    missingFields.push('preferences');
  }

  if (missingFields.length > 0) {
    return err(
      createValidationError(
        missingFields,
        `Cannot create Profile: missing required fields: ${missingFields.join(', ')}`,
      ),
    );
  }

  return ok({
    id: props.id,
    ownerId: props.ownerId,
    sector: props.sector,
    capabilities: props.capabilities ?? [],
    preferences: props.preferences,
  });
};
