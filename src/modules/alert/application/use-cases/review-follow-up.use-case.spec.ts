import { ReviewFollowUpUseCase, MAX_ALERT_ATTEMPTS } from './review-follow-up.use-case';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import {
  NotificationPort,
  NotificationRecipient,
  NotificationContent,
} from '../../domain/ports/notification.port';
import { Alert } from '../../domain/entities/alert.entity';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import {
  AlertId,
  ProfileId,
  OpportunityId,
  asAlertId,
  asProfileId,
  asOpportunityId,
  asUserId,
} from '../../../shared/domain/typed-id';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';

class FakeAlertRepository implements AlertRepositoryPort {
  public alerts: Map<string, Alert> = new Map();

  async save(alert: Alert): Promise<void> {
    this.alerts.set(alert.id, alert);
  }

  async createMany(alerts: Alert[]): Promise<void> {
    for (const a of alerts) {
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
    to: NotificationRecipient;
    content: NotificationContent;
  }> = [];
  public failNext: boolean = false;
  public failError: Error = new Error('SMTP connection error');

  async send(to: NotificationRecipient, content: NotificationContent): Promise<void> {
    if (this.failNext) {
      throw this.failError;
    }
    this.sentMessages.push({ to, content });
  }
}

class FakeProfileRepository implements ProfileRepositoryPort {
  public profiles: Map<string, Profile> = new Map();

  async save(profile: Profile): Promise<void> {
    this.profiles.set(profile.id, profile);
  }

  async findById(id: ProfileId): Promise<Profile | null> {
    return this.profiles.get(id) ?? null;
  }
}

class FakeOpportunityRepository implements Partial<OpportunityRepositoryPort> {
  public opportunities: Map<string, Opportunity> = new Map();

  async findById(id: OpportunityId): Promise<Opportunity | null> {
    return this.opportunities.get(id) ?? null;
  }
}

describe('ReviewFollowUpUseCase', () => {
  let alertRepo: FakeAlertRepository;
  let notificationPort: FakeNotificationPort;
  let profileRepo: FakeProfileRepository;
  let opportunityRepo: FakeOpportunityRepository;
  let useCase: ReviewFollowUpUseCase;

  const sampleProfile: Profile = {
    id: asProfileId('prof-1'),
    ownerId: asUserId('user-1'),
    name: 'Constructora Alfa',
    contactEmail: 'contacto@alfa.com',
    alertsEnabled: true,
    deadlineAlertDays: 5,
    sector: 'Infraestructura',
    capabilities: [],
    preferences: {
      categoryCodes: [],
      keywords: [],
      amountRange: null,
      departments: [],
    },
  };

  const sampleOpportunity: Opportunity = {
    id: asOpportunityId('opp-1'),
    title: 'Pavimentación Vial Urbana',
    description: 'Vías en Cali',
    contractingEntity: {
      name: 'Alcaldía de Cali',
      taxId: '890399011-1',
    },
    location: {
      department: 'Valle del Cauca',
      city: 'Cali',
    },
    amount: {
      amount: 200000000,
      currency: 'COP',
    },
    amountKnown: true,
    contractType: 'Obra',
    procurementModality: 'Selección abreviada',
    isCompetitive: true,
    categoryCode: '72141103',
    publishedAt: new Date('2026-10-01T08:00:00Z'),
    lastPublishedAt: new Date('2026-10-02T08:00:00Z'),
    closingDate: new Date('2026-10-28T22:00:00Z'),
    isOpenForSubmission: true,
    status: 'Published',
    source: {
      sourceName: 'SECOP',
      externalId: 'SECOP-100',
      humanReference: 'CO1.REQ.100',
      originalUrl: 'https://secop.gov.co/opp/100',
    },
    analysis: null,
    changeHistory: [],
  };

  beforeEach(() => {
    alertRepo = new FakeAlertRepository();
    notificationPort = new FakeNotificationPort();
    profileRepo = new FakeProfileRepository();
    opportunityRepo = new FakeOpportunityRepository();

    profileRepo.profiles.set(sampleProfile.id, sampleProfile);
    opportunityRepo.opportunities.set(sampleOpportunity.id, sampleOpportunity);

    useCase = new ReviewFollowUpUseCase(
      alertRepo,
      notificationPort,
      profileRepo,
      opportunityRepo as unknown as OpportunityRepositoryPort,
    );
  });

  it('returns alertsSent: 0 when there are no undelivered alerts', async () => {
    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsFailed).toBe(0);
      expect(result.value.alertsSkipped).toBe(0);
    }
    expect(notificationPort.sentMessages).toHaveLength(0);
  });

  it('delivers undelivered alerts, builds email, marks delivered, and updates repository', async () => {
    const alert: Alert = {
      id: asAlertId('alt-1'),
      profileId: sampleProfile.id,
      opportunityId: sampleOpportunity.id,
      trigger: 'DeadlineApproaching',
      changeKey: 'deadline:2026-10-28',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(alert);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(1);
      expect(result.value.alertsFailed).toBe(0);
      expect(result.value.alertsSkipped).toBe(0);
    }

    expect(notificationPort.sentMessages).toHaveLength(1);
    expect(notificationPort.sentMessages[0].to).toEqual({
      email: 'contacto@alfa.com',
      name: 'Constructora Alfa',
    });
    expect(notificationPort.sentMessages[0].content.subject).toContain('Plazo próximo a vencer');

    const updated = alertRepo.alerts.get(alert.id);
    expect(updated?.deliveredAt).toBeInstanceOf(Date);
  });

  it('records last_error and increments attempts on SMTP failure, without marking delivered', async () => {
    const alert: Alert = {
      id: asAlertId('alt-err'),
      profileId: sampleProfile.id,
      opportunityId: sampleOpportunity.id,
      trigger: 'Amendment',
      changeKey: 'amount:2026-10-10',
      attempts: 1,
      lastError: 'Earlier error',
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(alert);

    notificationPort.failNext = true;
    notificationPort.failError = new Error('SMTP connection timeout');

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsFailed).toBe(1);
    }

    const updated = alertRepo.alerts.get(alert.id);
    expect(updated?.deliveredAt).toBeNull();
    expect(updated?.attempts).toBe(2);
    expect(updated?.lastError).toBe('SMTP connection timeout');
  });

  it('skips alerts that have already reached maximum attempts (5)', async () => {
    const exhaustedAlert: Alert = {
      id: asAlertId('alt-max'),
      profileId: sampleProfile.id,
      opportunityId: sampleOpportunity.id,
      trigger: 'Amendment',
      changeKey: 'status:2026-10-10',
      attempts: MAX_ALERT_ATTEMPTS,
      lastError: 'Persistent network failure',
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(exhaustedAlert);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsSkipped).toBe(1);
    }
    expect(notificationPort.sentMessages).toHaveLength(0);
  });

  it('skips alerts when profile has alertsEnabled: false', async () => {
    const disabledProfile: Profile = {
      ...sampleProfile,
      id: asProfileId('prof-disabled'),
      alertsEnabled: false,
    };
    profileRepo.profiles.set(disabledProfile.id, disabledProfile);

    const alert: Alert = {
      id: asAlertId('alt-disabled'),
      profileId: disabledProfile.id,
      opportunityId: sampleOpportunity.id,
      trigger: 'DeadlineApproaching',
      changeKey: 'deadline:2026-10-28',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(alert);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsSkipped).toBe(1);
    }
    expect(notificationPort.sentMessages).toHaveLength(0);
  });

  it('skips alerts when profile has no email', async () => {
    const noEmailProfile: Profile = {
      ...sampleProfile,
      id: asProfileId('prof-no-email'),
      contactEmail: null,
    };
    profileRepo.profiles.set(noEmailProfile.id, noEmailProfile);

    const alert: Alert = {
      id: asAlertId('alt-no-email'),
      profileId: noEmailProfile.id,
      opportunityId: sampleOpportunity.id,
      trigger: 'DeadlineApproaching',
      changeKey: 'deadline:2026-10-28',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(alert);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsSkipped).toBe(1);
    }
    expect(notificationPort.sentMessages).toHaveLength(0);
  });

  it('marks alert as failed when opportunity is not found', async () => {
    const alert: Alert = {
      id: asAlertId('alt-no-opp'),
      profileId: sampleProfile.id,
      opportunityId: asOpportunityId('opp-nonexistent'),
      trigger: 'StatusChange',
      changeKey: 'status:2026-10-10',
      attempts: 0,
      lastError: null,
      readAt: null,
      deliveredAt: null,
    };
    await alertRepo.save(alert);

    const result = await useCase.execute();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.alertsSent).toBe(0);
      expect(result.value.alertsFailed).toBe(1);
    }
    const updated = alertRepo.alerts.get(alert.id);
    expect(updated?.lastError).toBe('Opportunity not found');
  });
});
