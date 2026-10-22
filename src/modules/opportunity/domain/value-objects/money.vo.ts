import { Result, ok, err } from '../../../shared/domain/result';
import {
  ValidationError,
  createValidationError,
} from '../../../shared/domain/errors';

export interface Money {
  readonly amount: number;
  readonly currency: 'COP';
}

export const createMoney = (amount: number): Result<Money, ValidationError> => {
  if (typeof amount !== 'number' || !Number.isFinite(amount) || isNaN(amount)) {
    return err(
      createValidationError(
        ['amount'],
        `Money amount must be a valid finite number, got: ${amount}`,
      ),
    );
  }

  if (amount < 0) {
    return err(
      createValidationError(
        ['amount'],
        `Money amount must be non-negative, got: ${amount}`,
      ),
    );
  }

  return ok({
    amount,
    currency: 'COP',
  });
};
