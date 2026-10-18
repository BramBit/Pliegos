import { Result, ok, err } from '../../../shared/domain/result';
import { ProfileNotFoundError, createProfileNotFoundError } from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import { Profile } from '../../domain/entities/profile.entity';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';

export class GetProfileByIdUseCase {
  constructor(private readonly repository: ProfileRepositoryPort) {}

  async execute(input: { profileId: ProfileId }): Promise<Result<Profile, ProfileNotFoundError>> {
    const profile = await this.repository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }
    return ok(profile);
  }
}
