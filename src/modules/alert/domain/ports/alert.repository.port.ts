import { Alert } from '../entities/alert.entity';

import { AlertId, UserId } from '../../../shared/domain/typed-id';

export interface AlertRepositoryPort {
  save(alert: Alert): Promise<void>;
  createMany(alerts: Alert[]): Promise<void>;
  findUndelivered(limit?: number): Promise<Alert[]>;
  findById?(id: AlertId, userId?: UserId): Promise<Alert | null>;
  markFailed(id: AlertId, error: string): Promise<void>;
}

export const ALERT_REPOSITORY_PORT = Symbol('ALERT_REPOSITORY_PORT');
