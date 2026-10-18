import { randomUUID } from 'node:crypto';
import { Result, ok } from '../../../shared/domain/result';
import { ValidationError } from '../../../shared/domain/errors';
import { ProfileId, asProfileId } from '../../../shared/domain/typed-id';
import { ProfileRepositoryPort } from '../../domain/ports/profile.repository.port';
import { Profile, createProfile } from '../../domain/entities/profile.entity';
import { createProfilePreferences } from '../../domain/value-objects/profile.value-objects';
import { RecommendationRefreshQueuePort } from '../../../recommendation/domain/ports/recommendation-refresh-queue.port';

export interface IConfigureProfileUseCase {
  execute(input: {
    profileId: ProfileId | null;
    data: Omit<Profile, 'id'>;
  }): Promise<Result<Profile, ValidationError>>;
}

export class ConfigureProfileUseCase implements IConfigureProfileUseCase {
  constructor(
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly refreshQueue?: RecommendationRefreshQueuePort,
  ) {}

  async execute(input: {
    profileId: ProfileId | null;
    data: Omit<Profile, 'id'>;
  }): Promise<Result<Profile, ValidationError>> {
    const id = input.profileId ?? asProfileId(randomUUID());

    const prefResult = createProfilePreferences({
      categoryCodes: input.data.preferences?.categoryCodes,
      keywords: input.data.preferences?.keywords,
      amountRange: input.data.preferences?.amountRange,
      departments: input.data.preferences?.departments,
    });

    if (!prefResult.ok) {
      return prefResult;
    }

    const profileResult = createProfile({
      id,
      ownerId: input.data.ownerId,
      name: input.data.name,
      contactEmail: input.data.contactEmail,
      alertsEnabled: input.data.alertsEnabled,
      deadlineAlertDays: input.data.deadlineAlertDays,
      sector: input.data.sector,
      capabilities: input.data.capabilities,
      preferences: prefResult.value,
    });

    if (!profileResult.ok) {
      return profileResult;
    }

    await this.profileRepository.save(profileResult.value);
    if (this.refreshQueue) {
      await this.refreshQueue.enqueueRefresh(profileResult.value.id);
    }
    return ok(profileResult.value);
  }
}
