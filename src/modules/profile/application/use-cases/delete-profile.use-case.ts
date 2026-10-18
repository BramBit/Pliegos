import { Result, ok, err } from '../../../shared/domain/result';
import { ProfileNotFoundError, createProfileNotFoundError } from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';

export class DeleteProfileUseCase {
  constructor(private readonly repository: ProfileRepositoryPort) {}

  async execute(input: { profileId: ProfileId }): Promise<Result<void, ProfileNotFoundError>> {
    const existing = await this.repository.findById(input.profileId);
    if (!existing) {
      return err(createProfileNotFoundError(input.profileId));
    }
    if (this.repository.delete) {
      await this.repository.delete(input.profileId);
    }
    return ok(undefined);
  }
}
