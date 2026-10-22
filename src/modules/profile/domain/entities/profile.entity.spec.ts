import { asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { createProfile, buildProfileQuery } from './profile.entity';
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

  describe('ProfilePreferences VO', () => {
    it('normalizes UNSPSC categoryCodes with normalizeUnspsc and drops invalid placeholders', () => {
      const prefs = createProfilePreferences({
        categoryCodes: ['V1.43230000', '81111500', 'UNSPECIFIED', 'V1.00000000', ''],
        keywords: ['software'],
      });

      expect(prefs.ok).toBe(true);
      if (prefs.ok) {
        expect(prefs.value.categoryCodes).toEqual(['43230000', '81111500']);
      }
    });

    it('canonicalizes departments accent-insensitively ("antioquia" -> "Antioquia", "BOGOTA" -> "Bogotá D.C.")', () => {
      const prefs = createProfilePreferences({
        departments: ['antioquia', 'BOGOTA', 'cundinamarca', 'VALLE'],
      });

      expect(prefs.ok).toBe(true);
      if (prefs.ok) {
        expect(prefs.value.departments).toEqual([
          'Antioquia',
          'Bogotá D.C.',
          'Cundinamarca',
          'Valle del Cauca',
        ]);
      }
    });

    it('rejects unknown departments with ValidationError', () => {
      const prefs = createProfilePreferences({
        departments: ['Antioquia', 'Narnia', 'Miami'],
      });

      expect(prefs.ok).toBe(false);
      if (!prefs.ok) {
        expect(prefs.error.fields).toContain('preferences.departments');
        expect(prefs.error.message).toContain('Unknown Colombian department');
      }
    });
  });

  describe('Profile Entity', () => {
    it('creates a valid Profile aggregate root and builds profile query text', () => {
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
        capabilities: [
          { name: 'Desarrollo Web', yearsOfExperience: 5 },
          { name: 'Ciberseguridad', yearsOfExperience: 3 },
        ],
        preferences: preferences.value,
      });

      expect(profile.ok).toBe(true);
      if (profile.ok) {
        expect(profile.value.id).toBe('profile-001');
        expect(profile.value.ownerId).toBe('user-001');
        expect(profile.value.capabilities).toHaveLength(2);
        expect(profile.value.preferences.categoryCodes).toEqual(['43230000', '81111500']);
        expect(profile.value.preferences.departments).toContain('Bogotá D.C.');
        expect(profile.value.alertsEnabled).toBe(true);
        expect(profile.value.deadlineAlertDays).toBe(3);
        expect(buildProfileQuery(profile.value)).toBe(
          'Tecnología e Informática. Desarrollo Web, Ciberseguridad. inteligencia artificial, software',
        );
      }
    });

    it('validates contactEmail format when provided', () => {
      const preferences = createProfilePreferences({ keywords: ['test'] });
      if (!preferences.ok) throw new Error('Prefs failed');

      const invalidEmail = createProfile({
        id: asProfileId('profile-002'),
        ownerId: asUserId('user-002'),
        sector: 'Tecnología',
        contactEmail: 'not-an-email',
        preferences: preferences.value,
      });

      expect(invalidEmail.ok).toBe(false);
      if (!invalidEmail.ok) {
        expect(invalidEmail.error.fields).toContain('contactEmail');
      }

      const validEmail = createProfile({
        id: asProfileId('profile-003'),
        ownerId: asUserId('user-003'),
        sector: 'Tecnología',
        contactEmail: 'contacto@empresa.com',
        preferences: preferences.value,
      });

      expect(validEmail.ok).toBe(true);
      if (validEmail.ok) {
        expect(validEmail.value.contactEmail).toBe('contacto@empresa.com');
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

    it('validates deadlineAlertDays is an integer between 1 and 30', () => {
      const preferences = createProfilePreferences({ keywords: ['test'] });
      if (!preferences.ok) throw new Error('Prefs failed');

      const tooSmall = createProfile({
        id: asProfileId('profile-days-1'),
        ownerId: asUserId('user-days-1'),
        sector: 'Tecnología',
        preferences: preferences.value,
        deadlineAlertDays: 0,
      });
      expect(tooSmall.ok).toBe(false);

      const tooLarge = createProfile({
        id: asProfileId('profile-days-2'),
        ownerId: asUserId('user-days-2'),
        sector: 'Tecnología',
        preferences: preferences.value,
        deadlineAlertDays: 31,
      });
      expect(tooLarge.ok).toBe(false);

      const nonInteger = createProfile({
        id: asProfileId('profile-days-3'),
        ownerId: asUserId('user-days-3'),
        sector: 'Tecnología',
        preferences: preferences.value,
        deadlineAlertDays: 3.5,
      });
      expect(nonInteger.ok).toBe(false);

      const validBoundaryMin = createProfile({
        id: asProfileId('profile-days-4'),
        ownerId: asUserId('user-days-4'),
        sector: 'Tecnología',
        preferences: preferences.value,
        deadlineAlertDays: 1,
      });
      expect(validBoundaryMin.ok).toBe(true);

      const validBoundaryMax = createProfile({
        id: asProfileId('profile-days-5'),
        ownerId: asUserId('user-days-5'),
        sector: 'Tecnología',
        preferences: preferences.value,
        deadlineAlertDays: 30,
      });
      expect(validBoundaryMax.ok).toBe(true);
    });
  });
});
