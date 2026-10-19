import { Result, ok } from '../../../shared/domain/result';
import { OpportunityId, ProfileId } from '../../../shared/domain/typed-id';
import { AlertRepositoryPort } from '../../domain/ports/alert.repository.port';
import { NotificationPort, NotificationRecipient } from '../../domain/ports/notification.port';
import { ProfileRepositoryPort } from '../../../profile/domain/ports/profile.repository.port';
import { OpportunityRepositoryPort } from '../../../opportunity/domain/ports/opportunity.repository.port';
import { markAlertDelivered } from '../../domain/entities/alert.entity';
import { buildAlertEmail } from '../../domain/services/build-alert-email';
import { Profile } from '../../../profile/domain/entities/profile.entity';
import { Opportunity } from '../../../opportunity/domain/entities/opportunity.entity';

export const MAX_ALERT_ATTEMPTS = 5;
export const DEFAULT_BATCH_SIZE = 100;

export interface ReviewFollowUpResult {
  readonly alertsSent: number;
  readonly alertsFailed: number;
  readonly alertsSkipped: number;
}

export interface IReviewFollowUpUseCase {
  execute(batchSize?: number): Promise<Result<ReviewFollowUpResult, never>>;
}

export class ReviewFollowUpUseCase implements IReviewFollowUpUseCase {
  constructor(
    private readonly alertRepository: AlertRepositoryPort,
    private readonly notificationPort: NotificationPort,
    private readonly profileRepository: ProfileRepositoryPort,
    private readonly opportunityRepository: OpportunityRepositoryPort,
  ) {}

  async execute(batchSize: number = DEFAULT_BATCH_SIZE): Promise<Result<ReviewFollowUpResult, never>> {
    const undeliveredAlerts = await this.alertRepository.findUndelivered(batchSize);

    let alertsSent = 0;
    let alertsFailed = 0;
    let alertsSkipped = 0;

    const profileCache = new Map<ProfileId, Profile | null>();
    const opportunityCache = new Map<OpportunityId, Opportunity | null>();

    const getProfile = async (id: ProfileId): Promise<Profile | null> => {
      if (profileCache.has(id)) {
        return profileCache.get(id)!;
      }
      const p = await this.profileRepository.findById(id);
      profileCache.set(id, p);
      return p;
    };

    const getOpportunity = async (id: OpportunityId): Promise<Opportunity | null> => {
      if (opportunityCache.has(id)) {
        return opportunityCache.get(id)!;
      }
      const o = await this.opportunityRepository.findById(id);
      opportunityCache.set(id, o);
      return o;
    };

    for (const alert of undeliveredAlerts) {
      if (alert.attempts >= MAX_ALERT_ATTEMPTS) {
        alertsSkipped++;
        continue;
      }

      const profile = await getProfile(alert.profileId);
      if (!profile || profile.alertsEnabled === false || !profile.contactEmail?.trim()) {
        alertsSkipped++;
        continue;
      }

      const opportunity = await getOpportunity(alert.opportunityId);
      if (!opportunity) {
        await this.alertRepository.markFailed(alert.id, 'Opportunity not found');
        alertsFailed++;
        continue;
      }

      const recipient: NotificationRecipient = {
        email: profile.contactEmail.trim(),
        name: profile.name,
      };

      const emailContent = buildAlertEmail(alert, opportunity, profile);

      try {
        await this.notificationPort.send(recipient, emailContent);
        const deliveredAlert = markAlertDelivered(alert, new Date());
        await this.alertRepository.save(deliveredAlert);
        alertsSent++;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.alertRepository.markFailed(alert.id, message);
        alertsFailed++;
      }
    }

    return ok({ alertsSent, alertsFailed, alertsSkipped });
  }
}
