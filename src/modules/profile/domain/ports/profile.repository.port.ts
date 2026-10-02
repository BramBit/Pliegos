import { Profile } from '../entities/profile.entity';
import { ProfileId } from '../../../shared/domain/typed-id';

export interface ProfileRepositoryPort {
  save(profile: Profile): Promise<void>;
  findById(id: ProfileId): Promise<Profile | null>;
}

export const PROFILE_REPOSITORY_PORT = Symbol('PROFILE_REPOSITORY_PORT');
