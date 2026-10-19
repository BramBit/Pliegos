import { Result, ok, err } from '../../../shared/domain/result';
import { AlertId } from '../../../shared/domain/typed-id';
import { Alert } from '../../domain/entities/alert.entity';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import {
  AlertNotFoundError,
  createAlertNotFoundError,
} from '../../../shared/domain/errors';

export interface MarkAlertReadInput {
  readonly alertId: AlertId;
}

export interface MarkAlertReadResult {
  readonly success: boolean;
  readonly alert: Alert;
}

export class MarkAlertReadUseCase {
  constructor(private readonly alertRepository: AlertRepositoryPort) {}

  async execute(
    input: MarkAlertReadInput,
  ): Promise<Result<MarkAlertReadResult, AlertNotFoundError>> {
    const alert = await this.alertRepository.findById(input.alertId);
    if (!alert) {
      return err(createAlertNotFoundError(input.alertId));
    }

    await this.alertRepository.markRead(input.alertId);
    const updatedAlert: Alert = {
      ...alert,
      readAt: alert.readAt ?? new Date(),
    };

    return ok({ success: true, alert: updatedAlert });
  }
}
