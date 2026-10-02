import { ConfigureProfileUseCase } from './configure-profile.use-case';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';
import { Profile } from '../../domain/entities/profile.entity';
import { ProfileId, asProfileId, asUserId } from '../../../shared/domain/typed-id';

class FakeProfileRepository implements ProfileRepositoryPort {
  public storage: Map<string, Profile> = new Map();

  async save(profile: Profile): Promise<void> {
    this.storage.set(profile.id, profile);
  }

  async findById(id: ProfileId): Promise<Profile | null> {
    return this.storage.get(id) ?? null;
  }
}

describe('ConfigureProfileUseCase', () => {
  let repository: FakeProfileRepository;
  let useCase: ConfigureProfileUseCase;

  const validProfileData: Omit<Profile, 'id'> = {
    ownerId: asUserId('user-100'),
    sector: 'Consultoría e Ingeniería',
    capabilities: [{ name: 'Interventoría', yearsOfExperience: 7 }],
    preferences: {
      categoryCodes: ['V1.81101500'],
      keywords: ['infraestructura', 'vías'],
      amountRange: { min: 100_000_000, max: 800_000_000 },
      departments: ['Antioquia'],
    },
  };

  beforeEach(() => {
    repository = new FakeProfileRepository();
    useCase = new ConfigureProfileUseCase(repository);
  });

  it('creates and saves a new Profile when profileId is null', async () => {
    const result = await useCase.execute({
      profileId: null,
      data: validProfileData,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeDefined();
      expect(result.value.ownerId).toBe('user-100');
      expect(result.value.sector).toBe('Consultoría e Ingeniería');
      expect(repository.storage.has(result.value.id)).toBe(true);
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
  });
});
