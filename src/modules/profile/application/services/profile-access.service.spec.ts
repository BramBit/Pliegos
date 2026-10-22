import { ProfileAccessService } from './profile-access.service';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';
import { asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { Profile } from '../../domain/entities/profile.entity';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';

describe('ProfileAccessService', () => {
  let service: ProfileAccessService;
  let mockRepo: jest.Mocked<ProfileRepositoryPort>;

  const profileA: Profile = {
    id: asProfileId('profile-a-id'),
    ownerId: asUserId('user-a-id'),
    name: 'Profile A',
    contactEmail: 'a@example.com',
    alertsEnabled: true,
    deadlineAlertDays: 3,
    sector: 'Tech',
    capabilities: [],
    preferences: {
      categoryCodes: [],
      keywords: [],
      amountRange: null,
      departments: [],
    },
  };

  beforeEach(() => {
    mockRepo = {
      save: jest.fn(),
      findById: jest.fn(),
      findByOwner: jest.fn(),
      delete: jest.fn(),
    };
    service = new ProfileAccessService(mockRepo);
  });

  it('returns the profile when the requesting user is the owner', async () => {
    mockRepo.findById.mockResolvedValue(profileA);

    const result = await service.assertOwner(profileA.id, {
      sub: 'user-a-id',
      role: 'user',
    });
    expect(result).toBe(profileA);
  });

  it('throws identical ProfileNotFoundError when profile does not exist', async () => {
    mockRepo.findById.mockResolvedValue(null);

    await expect(
      service.assertOwner(asProfileId('non-existent'), {
        sub: 'user-a-id',
        role: 'user',
      }),
    ).rejects.toThrow(DomainErrorException);

    try {
      await service.assertOwner(asProfileId('non-existent'), {
        sub: 'user-a-id',
        role: 'user',
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(DomainErrorException);
      expect(err.domainError.type).toBe('ProfileNotFoundError');
      expect(err.domainError.profileId).toBe('non-existent');
    }
  });

  it('throws identical ProfileNotFoundError when profile belongs to a different owner', async () => {
    mockRepo.findById.mockResolvedValue(profileA);

    // User B attempts to access User A's profile
    await expect(
      service.assertOwner(profileA.id, { sub: 'user-b-id', role: 'user' }),
    ).rejects.toThrow(DomainErrorException);

    // Verify error detail matches
    try {
      await service.assertOwner(profileA.id, {
        sub: 'user-b-id',
        role: 'user',
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(DomainErrorException);
      expect(err.domainError.type).toBe('ProfileNotFoundError');
      expect(err.domainError.profileId).toBe(profileA.id);
    }
  });
});
