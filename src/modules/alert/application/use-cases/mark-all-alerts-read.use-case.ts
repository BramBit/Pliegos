import { Result, ok } from '../../../shared/domain/result';
import { ProfileId } from '../../../shared/domain/typed-id';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';

export interface MarkAllAlertsReadInput {
  readonly profileId: ProfileId;
}

export interface MarkAllAlertsReadResult {
  readonly success: boolean;
  readonly markedCount: number;
}

export class MarkAllAlertsReadUseCase {
  constructor(private readonly alertRepository: AlertRepositoryPort) {}

  async execute(
    input: MarkAllAlertsReadInput,
  ): Promise<Result<MarkAllAlertsReadResult, never>> {
    const markedCount = await this.alertRepository.markAllRead(input.profileId);
    return ok({ success: true, markedCount });
  }
}
