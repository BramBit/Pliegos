import { Result, ok, err } from '../../../shared/domain/result';
import {
  ProfileNotFoundError,
  createProfileNotFoundError,
} from '../../../shared/domain/errors';
import { ProfileId } from '../../../shared/domain/typed-id';
import {
  WatchRepositoryPort,
  ProfileSummary,
} from '../../domain/ports/watch.repository.port';

export class GetProfileSummaryUseCase {
  constructor(private readonly watchRepository: WatchRepositoryPort) {}

  async execute(input: {
    profileId: ProfileId;
  }): Promise<Result<ProfileSummary, ProfileNotFoundError>> {
    const summary = await this.watchRepository.getProfileSummary(
      input.profileId,
    );
    if (!summary) {
      return err(createProfileNotFoundError(input.profileId));
    }

    return ok(summary);
  }
}
