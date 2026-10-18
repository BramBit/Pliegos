import { Profile } from '../entities/profile.entity';
import { ProfileId, UserId } from '../../../shared/domain/typed-id';

export interface ProfileRepositoryPort {
  save(profile: Profile): Promise<void>;
  findById(id: ProfileId): Promise<Profile | null>;
  findByOwner?(ownerId: UserId): Promise<Profile[]>;
  delete?(id: ProfileId): Promise<boolean>;
}

export const PROFILE_REPOSITORY_PORT = Symbol('PROFILE_REPOSITORY_PORT');
