import { Alert } from '../entities/alert.entity';

import { AlertId, UserId } from '../../../shared/domain/typed-id';

export interface AlertRepositoryPort {
  save(alert: Alert): Promise<void>;
  findUndelivered(): Promise<Alert[]>;
  findById?(id: AlertId, userId?: UserId): Promise<Alert | null>;
}

export const ALERT_REPOSITORY_PORT = Symbol('ALERT_REPOSITORY_PORT');
