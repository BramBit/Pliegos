import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  OpportunityNotFoundError,
  createProfileNotFoundError,
  createOpportunityNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId, OpportunityId } from '../../../shared/domain/typed-id';
import { WatchRepositoryPort } from '../../domain/ports/watch.repository.port';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';

export class WatchOpportunityUseCase {
  constructor(
    private readonly watchRepository: WatchRepositoryPort,
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly opportunityRepository: OpportunityRepositoryPort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
    opportunityId: OpportunityId;
  }): Promise<Result<void, ProfileNotFoundError | OpportunityNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    const opportunity = await this.opportunityRepository.findById(input.opportunityId);
    if (!opportunity) {
      return err(createOpportunityNotFoundError(input.opportunityId));
    }

    await this.watchRepository.addWatch(input.profileId, input.opportunityId);
    return ok(undefined);
  }
}
