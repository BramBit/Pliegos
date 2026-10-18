import { Result, ok } from '../../../shared/domain/result';
import { UserId } from '../../../shared/domain/typed-id';
import { Profile } from '../../domain/entities/profile.entity';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';

export class GetProfilesByOwnerUseCase {
  constructor(private readonly repository: ProfileRepositoryPort) {}

  async execute(input: { ownerId: UserId }): Promise<Result<Profile[], never>> {
    const profiles = this.repository.findByOwner
      ? await this.repository.findByOwner(input.ownerId)
      : [];
    return ok(profiles);
  }
}
