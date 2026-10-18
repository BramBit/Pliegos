import { ConfigureProfileUseCase } from './configure-profile.use-case';
import { GetProfileByIdUseCase } from './get-profile-by-id.use-case';
import { GetProfilesByOwnerUseCase } from './get-profiles-by-owner.use-case';
import { DeleteProfileUseCase } from './delete-profile.use-case';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';
import { Profile } from '../../domain/entities/profile.entity';
import { ProfileId, UserId, asProfileId, asUserId } from '../../../shared/domain/typed-id';
import { RecommendationRefreshQueuePort } from '../../../recommendation/domain/ports/recommendation-refresh-queue.port';

class FakeProfileRepository implements ProfileRepositoryPort {
  public storage: Map<string, Profile> = new Map();

  async save(profile: Profile): Promise<void> {
    this.storage.set(profile.id, profile);
  }

  async findById(id: ProfileId): Promise<Profile | null> {
    return this.storage.get(id) ?? null;
  }

  async findByOwner(ownerId: UserId): Promise<Profile[]> {
    return Array.from(this.storage.values()).filter((p) => p.ownerId === ownerId);
  }

  async delete(id: ProfileId): Promise<boolean> {
    return this.storage.delete(id);
  }
}

class FakeRefreshQueue implements RecommendationRefreshQueuePort {
  public enqueued: ProfileId[] = [];

  async enqueueRefresh(profileId: ProfileId): Promise<void> {
    this.enqueued.push(profileId);
  }
}

describe('Profile Use Cases', () => {
  let repository: FakeProfileRepository;
  let refreshQueue: FakeRefreshQueue;
  let useCase: ConfigureProfileUseCase;
  let getByIdUseCase: GetProfileByIdUseCase;
  let getByOwnerUseCase: GetProfilesByOwnerUseCase;
  let deleteUseCase: DeleteProfileUseCase;

  const validProfileData: Omit<Profile, 'id'> = {
    ownerId: asUserId('user-100'),
    name: 'Tech SAS',
    contactEmail: 'contacto@tech.com',
    alertsEnabled: true,
    deadlineAlertDays: 3,
    sector: 'Consultoría e Ingeniería',
    capabilities: [{ name: 'Interventoría', yearsOfExperience: 7 }],
    preferences: {
      categoryCodes: ['V1.81101500'],
      keywords: ['infraestructura', 'vías'],
      amountRange: { min: 100_000_000, max: 800_000_000 },
      departments: ['antioquia', 'BOGOTA'],
    },
  };

  beforeEach(() => {
    repository = new FakeProfileRepository();
    refreshQueue = new FakeRefreshQueue();
    useCase = new ConfigureProfileUseCase(repository, refreshQueue);
    getByIdUseCase = new GetProfileByIdUseCase(repository);
    getByOwnerUseCase = new GetProfilesByOwnerUseCase(repository);
    deleteUseCase = new DeleteProfileUseCase(repository);
  });

  describe('ConfigureProfileUseCase', () => {
    it('creates and saves a new Profile with canonicalized departments and enqueues refresh', async () => {
      const result = await useCase.execute({
        profileId: null,
        data: validProfileData,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBeDefined();
        expect(result.value.ownerId).toBe('user-100');
        expect(result.value.name).toBe('Tech SAS');
        expect(result.value.contactEmail).toBe('contacto@tech.com');
        expect(result.value.preferences.departments).toEqual(['Antioquia', 'Bogotá D.C.']);
        expect(repository.storage.has(result.value.id)).toBe(true);
        expect(refreshQueue.enqueued).toContain(result.value.id);
      }
    });

    it('updates profile using provided profileId', async () => {
      const customId = asProfileId('profile-custom-1');
      const result = await useCase.execute({
        profileId: customId,
        data: validProfileData,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.id).toBe(customId);
        expect(repository.storage.get(customId)).toEqual(result.value);
        expect(refreshQueue.enqueued).toContain(customId);
      }
    });

    it('returns ValidationError when required fields are missing', async () => {
      const invalidData = {
        ...validProfileData,
        sector: '',
      };

      const result = await useCase.execute({
        profileId: null,
        data: invalidData,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('ValidationError');
        expect(result.error.fields).toContain('sector');
      }
      expect(repository.storage.size).toBe(0);
      expect(refreshQueue.enqueued).toHaveLength(0);
    });

    it('returns ValidationError when departments are unknown', async () => {
      const invalidData = {
        ...validProfileData,
        preferences: {
          ...validProfileData.preferences,
          departments: ['Narnia', 'Antioquia'],
        },
      };

      const result = await useCase.execute({
        profileId: null,
        data: invalidData,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('ValidationError');
        expect(result.error.fields).toContain('preferences.departments');
      }
    });

    it('enforces maxProfilesPerUser limit when creating new profiles', async () => {
      const limitedUseCase = new ConfigureProfileUseCase(repository, refreshQueue, 2);

      // 1st profile -> success
      const res1 = await limitedUseCase.execute({ profileId: null, data: validProfileData });
      expect(res1.ok).toBe(true);

      // 2nd profile -> success
      const res2 = await limitedUseCase.execute({ profileId: null, data: validProfileData });
      expect(res2.ok).toBe(true);

      // 3rd profile -> rejected
      const res3 = await limitedUseCase.execute({ profileId: null, data: validProfileData });
      expect(res3.ok).toBe(false);
      if (!res3.ok) {
        expect(res3.error.type).toBe('ValidationError');
        expect(res3.error.message).toContain('Maximum profiles limit reached');
      }

      // Updating an existing profile succeeds and does not increment count
      if (res1.ok) {
        const updateRes = await limitedUseCase.execute({
          profileId: res1.value.id,
          data: { ...validProfileData, name: 'Updated Name' },
        });
        expect(updateRes.ok).toBe(true);
      }
    });
  });

  describe('GetProfileByIdUseCase', () => {
    it('returns profile when found and ProfileNotFoundError when not', async () => {
      const id = asProfileId('p-1');
      await useCase.execute({ profileId: id, data: validProfileData });

      const found = await getByIdUseCase.execute({ profileId: id });
      expect(found.ok).toBe(true);

      const notFound = await getByIdUseCase.execute({ profileId: asProfileId('unknown') });
      expect(notFound.ok).toBe(false);
      if (!notFound.ok) {
        expect(notFound.error.type).toBe('ProfileNotFoundError');
      }
    });
  });

  describe('GetProfilesByOwnerUseCase', () => {
    it('returns all profiles for a given owner', async () => {
      const id1 = asProfileId('p-1');
      const id2 = asProfileId('p-2');
      await useCase.execute({ profileId: id1, data: validProfileData });
      await useCase.execute({ profileId: id2, data: { ...validProfileData, ownerId: asUserId('other-user') } });

      const owned = await getByOwnerUseCase.execute({ ownerId: asUserId('user-100') });
      expect(owned.ok).toBe(true);
      if (owned.ok) {
        expect(owned.value).toHaveLength(1);
        expect(owned.value[0].id).toBe(id1);
      }
    });
  });

  describe('DeleteProfileUseCase', () => {
    it('deletes existing profile and returns ProfileNotFoundError if not exists', async () => {
      const id = asProfileId('p-delete-test');
      await useCase.execute({ profileId: id, data: validProfileData });

      const del = await deleteUseCase.execute({ profileId: id });
      expect(del.ok).toBe(true);
      expect(repository.storage.has(id)).toBe(false);

      const delAgain = await deleteUseCase.execute({ profileId: id });
      expect(delAgain.ok).toBe(false);
      if (!delAgain.ok) {
        expect(delAgain.error.type).toBe('ProfileNotFoundError');
      }
    });
  });
});
