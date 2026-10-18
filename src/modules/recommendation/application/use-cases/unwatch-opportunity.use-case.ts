import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId, OpportunityId } from '../../../shared/domain/typed-id';
import { WatchRepositoryPort } from '../../domain/ports/watch.repository.port';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';

export class UnwatchOpportunityUseCase {
  constructor(
    private readonly watchRepository: WatchRepositoryPort,
    private readonly profileRepository: ProfileRepositoryPort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
    opportunityId: OpportunityId;
  }): Promise<Result<void, ProfileNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    await this.watchRepository.removeWatch(input.profileId, input.opportunityId);
    return ok(undefined);
  }
}
