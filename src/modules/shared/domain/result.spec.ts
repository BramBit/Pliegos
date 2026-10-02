import { ok, err, isOk, isErr, mapResult, flatMapResult, Result } from './result';
import {
  asOpportunityId,
  asProfileId,
  asRecommendationId,
  asAlertId,
  asUserId,
} from './typed-id';
import {
  createSourceUnavailableError,
  createProfileNotFoundError,
  createRecommendationNotFoundError,
  createValidationError,
} from './errors';

describe('Shared Domain Kernel', () => {
  describe('Result type and combinators', () => {
    it('creates an Ok result holding a value', () => {
      const res = ok(42);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value).toBe(42);
      }
    });

    it('creates an Err result holding an error', () => {
      const res = err('something broke');
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe('something broke');
      }
    });

    it('distinguishes between ok and err using type guards isOk and isErr', () => {
      const success: Result<string, number> = ok('success');
      const failure: Result<string, number> = err(500);

      expect(isOk(success)).toBe(true);
      expect(isErr(success)).toBe(false);

      expect(isOk(failure)).toBe(false);
      expect(isErr(failure)).toBe(true);
    });

    it('maps Ok values with mapResult', () => {
      const success = ok(10);
      const mapped = mapResult(success, (n) => n * 2);
      expect(mapped).toEqual({ ok: true, value: 20 });

      const failure = err('failed');
      const mappedFail = mapResult(failure, (n: number) => n * 2);
      expect(mappedFail).toEqual({ ok: false, error: 'failed' });
    });

    it('chains operations with flatMapResult', () => {
      const divide = (numerator: number, denominator: number): Result<number, string> => {
        if (denominator === 0) return err('division by zero');
        return ok(numerator / denominator);
      };

      const step1 = ok(100);
      const step2 = flatMapResult(step1, (val) => divide(val, 2));
      expect(step2).toEqual({ ok: true, value: 50 });

      const step3 = flatMapResult(step2, (val) => divide(val, 0));
      expect(step3).toEqual({ ok: false, error: 'division by zero' });

      const failInput: Result<number, string> = err('initial failure');
      const skipped = flatMapResult(failInput, (val) => divide(val, 2));
      expect(skipped).toEqual({ ok: false, error: 'initial failure' });
    });
  });

  describe('Typed IDs', () => {
    it('creates branded strings correctly', () => {
      const oppId = asOpportunityId('opp-123');
      const profId = asProfileId('prof-456');
      const recId = asRecommendationId('rec-789');
      const alertId = asAlertId('alert-101');
      const userId = asUserId('user-202');

      expect(oppId).toBe('opp-123');
      expect(profId).toBe('prof-456');
      expect(recId).toBe('rec-789');
      expect(alertId).toBe('alert-101');
      expect(userId).toBe('user-202');
    });
  });

  describe('Domain Errors', () => {
    it('creates SourceUnavailableError', () => {
      const error = createSourceUnavailableError('SECOP');
      expect(error).toEqual({
        type: 'SourceUnavailableError',
        sourceName: 'SECOP',
      });
    });

    it('creates ProfileNotFoundError', () => {
      const profileId = asProfileId('p-1');
      const error = createProfileNotFoundError(profileId);
      expect(error).toEqual({
        type: 'ProfileNotFoundError',
        profileId: 'p-1',
      });
    });

    it('creates RecommendationNotFoundError', () => {
      const recommendationId = asRecommendationId('r-1');
      const error = createRecommendationNotFoundError(recommendationId);
      expect(error).toEqual({
        type: 'RecommendationNotFoundError',
        recommendationId: 'r-1',
      });
    });

    it('creates ValidationError', () => {
      const error = createValidationError(['amount', 'currency'], 'Invalid amount');
      expect(error).toEqual({
        type: 'ValidationError',
        fields: ['amount', 'currency'],
        message: 'Invalid amount',
      });
    });
  });
});
