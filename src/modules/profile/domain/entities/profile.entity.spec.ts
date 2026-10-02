import { asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { createProfile } from './profile.entity';
import {
  createAmountRange,
  createProfilePreferences,
} from '../value-objects/profile.value-objects';

describe('Profile Entity & Value Objects', () => {
  describe('AmountRange VO', () => {
    it('creates valid AmountRange when min <= max and both non-negative', () => {
      const range = createAmountRange(10000000, 50000000);
      expect(range.ok).toBe(true);
      if (range.ok) {
        expect(range.value.min).toBe(10000000);
        expect(range.value.max).toBe(50000000);
      }
    });

    it('rejects min > max', () => {
      const invalid = createAmountRange(100, 50);
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error.fields).toContain('amountRange');
      }
    });

    it('rejects negative numbers or non-finite values', () => {
      expect(createAmountRange(-10, 100).ok).toBe(false);
      expect(createAmountRange(10, NaN).ok).toBe(false);
    });
  });

  describe('Profile Entity', () => {
    it('creates a valid Profile aggregate root', () => {
      const range = createAmountRange(10000000, 200000000);
      if (!range.ok) throw new Error('Range failed');

      const preferences = createProfilePreferences({
        categoryCodes: ['V1.43230000', 'V1.81111500'],
        keywords: ['inteligencia artificial', 'software'],
        amountRange: range.value,
        departments: ['Bogotá D.C.', 'Antioquia'],
      });
      if (!preferences.ok) throw new Error('Preferences failed');

      const profile = createProfile({
        id: asProfileId('profile-001'),
        ownerId: asUserId('user-001'),
        sector: 'Tecnología e Informática',
        capabilities: [{ name: 'Desarrollo Web', yearsOfExperience: 5 }],
        preferences: preferences.value,
      });

      expect(profile.ok).toBe(true);
      if (profile.ok) {
        expect(profile.value.id).toBe('profile-001');
        expect(profile.value.ownerId).toBe('user-001');
        expect(profile.value.capabilities).toHaveLength(1);
        expect(profile.value.preferences.departments).toContain('Bogotá D.C.');
      }
    });

    it('rejects creation when required fields are missing', () => {
      const invalid = createProfile({
        id: asProfileId(''),
        ownerId: asUserId(''),
        sector: '',
        preferences: null as any,
      });

      expect(invalid.ok).toBe(false);
      if (!invalid.ok) {
        expect(invalid.error.fields).toContain('id');
        expect(invalid.error.fields).toContain('ownerId');
        expect(invalid.error.fields).toContain('sector');
        expect(invalid.error.fields).toContain('preferences');
      }
    });
  });
});
