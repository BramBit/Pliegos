import { Alert, AlertTrigger } from '../entities/alert.entity';
import { AlertId, OpportunityId, ProfileId, UserId } from '../../../shared/domain/typed-id';

export interface AlertItemOpportunitySummary {
  readonly id: string;
  readonly title: string;
  readonly entity: string;
  readonly amount: number;
  readonly closingDate: Date | null;
}

export interface AlertInboxItem {
  readonly id: AlertId;
  readonly profileId: ProfileId;
  readonly opportunityId: OpportunityId;
  readonly trigger: AlertTrigger;
  readonly changeKey: string;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly readAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
  readonly opportunitySummary: AlertItemOpportunitySummary;
}

export interface PaginatedAlertInbox {
  readonly items: AlertInboxItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface AlertRepositoryPort {
  save(alert: Alert): Promise<void>;
  createMany(alerts: Alert[]): Promise<void>;
  findUndelivered(limit?: number): Promise<Alert[]>;
  findById(id: AlertId, userId?: UserId): Promise<Alert | null>;
  markFailed(id: AlertId, error: string): Promise<void>;
  findByProfile(
    profileId: ProfileId,
    page?: number,
    pageSize?: number,
  ): Promise<PaginatedAlertInbox>;
  markRead(id: AlertId): Promise<boolean>;
  markAllRead(profileId: ProfileId): Promise<number>;
}

export const ALERT_REPOSITORY_PORT = Symbol('ALERT_REPOSITORY_PORT');
