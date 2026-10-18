import { Inject, Injectable } from '@nestjs/common';
import {
  PROFILE_REPOSITORY_PORT,
  ProfileRepositoryPort,
} from '../../domain/ports/profile.repository.port';
import { ProfileId } from '../../../shared/domain/typed-id';
import { Profile } from '../../domain/entities/profile.entity';
import { createProfileNotFoundError } from '../../../shared/domain/errors';
import { DomainErrorException } from '../../../shared/infrastructure/http/global-exception.filter';
import { CurrentUserPayload } from '../../../auth/infrastructure/security/current-user.decorator';

@Injectable()
export class ProfileAccessService {
  constructor(
    @Inject(PROFILE_REPOSITORY_PORT)
    private readonly profileRepository: ProfileRepositoryPort,
  ) {}

  async assertOwner(
    profileId: ProfileId,
    user: CurrentUserPayload | { sub: string; role?: string },
  ): Promise<Profile> {
    const profile = await this.profileRepository.findById(profileId);
    if (!profile || profile.ownerId !== user.sub) {
      throw new DomainErrorException(createProfileNotFoundError(profileId));
    }
    return profile;
  }
}
