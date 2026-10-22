import { ProfileId, UserId } from '../../../shared/domain/typed-id';
import { Capability, ProfilePreferences } from '../value-objects/profile.value-objects';
import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';

export interface Profile {
  readonly id: ProfileId;
  readonly ownerId: UserId;
  readonly name?: string | null;
  readonly contactEmail?: string | null;
  readonly alertsEnabled?: boolean;
  readonly deadlineAlertDays?: number;
  readonly sector: string;
  readonly capabilities: Capability[];
  readonly preferences: ProfilePreferences;
}

export interface CreateProfileProps {
  readonly id: ProfileId;
  readonly ownerId: UserId;
  readonly name?: string | null;
  readonly contactEmail?: string | null;
  readonly alertsEnabled?: boolean;
  readonly deadlineAlertDays?: number;
  readonly sector: string;
  readonly capabilities?: Capability[];
  readonly preferences: ProfilePreferences;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  const trimmedEmail = props.contactEmail ? props.contactEmail.trim() : null;
  if (trimmedEmail && !EMAIL_REGEX.test(trimmedEmail)) {
    return err(
      createValidationError(
        ['contactEmail'],
        `Invalid contactEmail: "${trimmedEmail}". Must be a valid email address.`,
      ),
    );
  }

  const deadlineDays = props.deadlineAlertDays ?? 3;
  if (!Number.isInteger(deadlineDays) || deadlineDays < 1 || deadlineDays > 30) {
    return err(
      createValidationError(
        ['deadlineAlertDays'],
        'deadlineAlertDays must be an integer between 1 and 30',
      ),
    );
  }

  return ok({
    id: props.id,
    ownerId: props.ownerId,
    name: props.name?.trim() || null,
    contactEmail: trimmedEmail,
    alertsEnabled: props.alertsEnabled ?? true,
    deadlineAlertDays: deadlineDays,
    sector: props.sector.trim(),
    capabilities: props.capabilities ?? [],
    preferences: props.preferences,
  });
};

/**
 * Pure domain function that builds the query text representing a Profile:
 * "{sector}. {capability names joined by ', '}. {keywords joined by ', '}"
 */
export function buildProfileQuery(profile: Profile): string {
  const parts: string[] = [];
  if (profile.sector && profile.sector.trim() !== '') {
    parts.push(profile.sector.trim());
  }
  const capabilityNames = profile.capabilities
    .map((c: Capability) => c.name.trim())
    .filter(Boolean)
    .join(', ');
  if (capabilityNames) {
    parts.push(capabilityNames);
  }
  const keywords = profile.preferences.keywords
    .map((k: string) => k.trim())
    .filter(Boolean)
    .join(', ');
  if (keywords) {
    parts.push(keywords);
  }
  return parts.join('. ');
}
