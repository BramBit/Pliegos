import { Result, ok } from '../../../shared/domain/result';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import { NotificationPort } from '../../domain/ports/notification.port';
import { markAlertDelivered } from '../../domain/entities/alert.entity';

export interface IReviewFollowUpUseCase {
  execute(): Promise<Result<{ alertsSent: number }, never>>;
}

export class ReviewFollowUpUseCase implements IReviewFollowUpUseCase {
  constructor(
    private readonly alertRepository: AlertRepositoryPort,
    private readonly notificationPort: NotificationPort,
  ) {}

  async execute(): Promise<Result<{ alertsSent: number }, never>> {
    const undeliveredAlerts = await this.alertRepository.findUndelivered();
    let alertsSent = 0;

    for (const alert of undeliveredAlerts) {
      let message = `Notificación para el proceso ${alert.opportunityId}`;
      if (alert.trigger === 'Amendment') {
        message = `Alerta: se detectaron adendas o modificaciones en el proceso ${alert.opportunityId}.`;
      } else if (alert.trigger === 'DeadlineApproaching') {
        message = `Alerta: la fecha de cierre está próxima para el proceso ${alert.opportunityId}.`;
      } else if (alert.trigger === 'StatusChange') {
        message = `Alerta: el proceso ${alert.opportunityId} ha cambiado de estado.`;
      }

      await this.notificationPort.send(alert.profileId, message, 'email');
      const deliveredAlert = markAlertDelivered(alert, new Date());
      await this.alertRepository.save(deliveredAlert);
      alertsSent++;
    }

    return ok({ alertsSent });
  }
}
