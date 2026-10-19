import { Result, ok } from '../../../shared/domain/result';
import { ProfileId } from '../../../shared/domain/typed-id';
import {
  AlertRepositoryPort,
  PaginatedAlertInbox,
} from '../../domain/ports/alert.repository.port';

export interface GetProfileAlertsInput {
  readonly profileId: ProfileId;
  readonly page?: number;
  readonly pageSize?: number;
}

export class GetProfileAlertsUseCase {
  constructor(private readonly alertRepository: AlertRepositoryPort) {}

  async execute(input: GetProfileAlertsInput): Promise<Result<PaginatedAlertInbox, never>> {
    const result = await this.alertRepository.findByProfile(
      input.profileId,
      input.page,
      input.pageSize,
    );
    return ok(result);
  }
}
