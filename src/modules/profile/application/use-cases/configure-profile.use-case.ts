import { randomUUID } from 'node:crypto';
import { Result, ok } from '../../../shared/domain/result';
import { ValidationError } from '../../../shared/domain/errors';
import { ProfileId, asProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';
import { Profile, createProfile } from '../../domain/entities/profile.entity';

export interface IConfigureProfileUseCase {
  execute(input: {
    profileId: ProfileId | null;
    data: Omit<Profile, 'id'>;
  }): Promise<Result<Profile, ValidationError>>;
}

export class ConfigureProfileUseCase implements IConfigureProfileUseCase {
  constructor(private readonly profileRepository: ProfileRepositoryPort) {}

  async execute(input: {
    profileId: ProfileId | null;
    data: Omit<Profile, 'id'>;
  }): Promise<Result<Profile, ValidationError>> {
    const id = input.profileId ?? asProfileId(randomUUID());

    const profileResult = createProfile({
      id,
      ownerId: input.data.ownerId,
      sector: input.data.sector,
      capabilities: input.data.capabilities,
      preferences: input.data.preferences,
    });

    if (!profileResult.ok) {
      return profileResult;
    }

    await this.profileRepository.save(profileResult.value);
    return ok(profileResult.value);
  }
}
