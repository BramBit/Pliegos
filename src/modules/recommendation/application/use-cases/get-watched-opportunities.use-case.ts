import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import {
  WatchRepositoryPort,
  PagedWatchedOpportunities,
} from '../../domain/ports/watch.repository.port';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';

export class GetWatchedOpportunitiesUseCase {
  constructor(
    private readonly watchRepository: WatchRepositoryPort,
    private readonly profileRepository: ProfileRepositoryPort,
  ) {}

  async execute(input: {
    profileId: ProfileId;
    page?: number;
    pageSize?: number;
  }): Promise<Result<PagedWatchedOpportunities, ProfileNotFoundError>> {
    const profile = await this.profileRepository.findById(input.profileId);
    if (!profile) {
      return err(createProfileNotFoundError(input.profileId));
    }

    const paged = await this.watchRepository.findWatchedPaged(
      input.profileId,
      input.page,
      input.pageSize,
    );

    return ok(paged);
  }
}
