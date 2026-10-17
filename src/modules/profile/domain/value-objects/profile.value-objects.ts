import { Result, ok, err } from '../../../shared/domain/result';
import { ValidationError, createValidationError } from '../../../shared/domain/errors';
import { normalizeUnspsc } from '../../../opportunity/infrastructure/adapters/secop/normalizers';

export interface AmountRange {
  readonly min: number;
  readonly max: number;
}

export interface ProfilePreferences {
  readonly categoryCodes: string[]; // UNSPSC codes of interest
  readonly keywords: string[]; // free text, feeds semantic matching
  readonly amountRange: AmountRange | null;
  readonly departments: string[]; // empty = no preference
}

export interface Capability {
  readonly name: string;
  readonly yearsOfExperience: number;
}

export const createAmountRange = (min: number, max: number): Result<AmountRange, ValidationError> => {
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    min < 0 ||
    max < 0
  ) {
    return err(
      createValidationError(['amountRange'], 'Amount range min and max must be non-negative finite numbers'),
    );
  }

  if (min > max) {
    return err(
      createValidationError(['amountRange'], `Amount range min (${min}) cannot exceed max (${max})`),
    );
  }

  return ok({ min, max });
};

export const createProfilePreferences = (props: {
  categoryCodes?: string[];
  keywords?: string[];
  amountRange?: AmountRange | null;
  departments?: string[];
}): Result<ProfilePreferences, ValidationError> => {
  const categoryCodes = (props.categoryCodes ?? [])
    .map((code) => normalizeUnspsc(code))
    .filter((code): code is string => code !== null);

  return ok({
    categoryCodes,
    keywords: props.keywords ?? [],
    amountRange: props.amountRange ?? null,
    departments: props.departments ?? [],
  });
};
