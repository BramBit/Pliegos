import { ReviewFollowUpUseCase } from './review-follow-up.use-case';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import {
  NotificationPort,
  NotificationChannel,
} from '../../domain/ports/notification.port';
import { Alert } from '../../domain/entities/alert.entity';
import {
  AlertId,
  ProfileId,
  asAlertId,
  asProfileId,
  asOpportunityId,
} from '../../../shared/domain/typed-id';

class FakeAlertRepository implements AlertRepositoryPort {
  public alerts: Map<string, Alert> = new Map();

  async save(alert: Alert): Promise<void> {
    this.alerts.set(alert.id, alert);
  }

  async createMany(alerts: Alert[]): Promise<void> {
    for (const a of alerts) {
      // simulate ON CONFLICT (profileId, opportunityId, trigger, changeKey) DO NOTHING
      const exists = Array.from(this.alerts.values()).some(
        (existing) =>
          existing.profileId === a.profileId &&
          existing.opportunityId === a.opportunityId &&
          existing.trigger === a.trigger &&
          existing.changeKey === a.changeKey,
      );
      if (!exists) {
        this.alerts.set(a.id, a);
      }
    }
  }

  async findUndelivered(limit?: number): Promise<Alert[]> {
    const list = Array.from(this.alerts.values()).filter((a) => a.deliveredAt === null);
    return limit ? list.slice(0, limit) : list;
  }

  async markFailed(id: AlertId, error: string): Promise<void> {
    const alert = this.alerts.get(id);
    if (alert) {
      this.alerts.set(id, {
        ...alert,
        attempts: (alert.attempts ?? 0) + 1,
        lastError: error,
      });
    }
  }
}

class FakeNotificationPort implements NotificationPort {
  public sentMessages: Array<{
    profileId: ProfileId;
    message: string;
    channel: NotificationChannel;
  }> = [];

  async send(
    profileId: ProfileId,
    message: string,
    channel: NotificationChannel,
  ): Promise<void> {
    this.sentMessages.push({ profileId, message, channel });
  }
}

describe('ReviewFollowUpUseCase', () => {
  let alertRepo: FakeAlertRepository;
  let notificationPort: FakeNotificationPort;
  let useCase: ReviewFollowUpUseCase;

  beforeEach(() => {
    alertRepo = new FakeAlertRepository();
    notificationPort = new FakeNotificationPort();
    useCase = new ReviewFollowUpUseCase(alertRepo, notificationPort);
  });

  it('returns alertsSent: 0 when there are no undelivered alerts', async () => {
    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
    }
    expect(notificationPort.sentMessages).toHaveLength(0);
  });

  it('processes all undelivered alerts, sends notifications, marks them delivered, and updates repository', async () => {
    const alert1: Alert = {
      id: asAlertId('alert-1'),
      profileId: asProfileId('prof-1'),
      opportunityId: asOpportunityId('opp-1'),
      trigger: 'Amendment',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const alert2: Alert = {
      id: asAlertId('alert-2'),
      profileId: asProfileId('prof-2'),
      opportunityId: asOpportunityId('opp-2'),
      trigger: 'DeadlineApproaching',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    const alert3: Alert = {
      id: asAlertId('alert-3'),
      profileId: asProfileId('prof-3'),
      opportunityId: asOpportunityId('opp-3'),
      trigger: 'StatusChange',
      changeKey: '',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };

    await alertRepo.save(alert1);
    await alertRepo.save(alert2);
    await alertRepo.save(alert3);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(3);
    }

    expect(notificationPort.sentMessages).toHaveLength(3);
    expect(notificationPort.sentMessages[0].channel).toBe('email');
    expect(notificationPort.sentMessages[0].message).toContain('adendas o modificaciones');
    expect(notificationPort.sentMessages[1].message).toContain('fecha de cierre está próxima');
    expect(notificationPort.sentMessages[2].message).toContain('cambiado de estado');

    // Confirm all alerts are marked delivered in repository
    const remainingUndelivered = await alertRepo.findUndelivered();
    expect(remainingUndelivered).toHaveLength(0);

    const updated1 = alertRepo.alerts.get('alert-1');
    expect(updated1?.deliveredAt).toBeInstanceOf(Date);
  });
});
