import { Alert } from '../entities/alert.entity';

export interface AlertRepositoryPort {
  save(alert: Alert): Promise<void>;
  findUndelivered(): Promise<Alert[]>;
}

export const ALERT_REPOSITORY_PORT = Symbol('ALERT_REPOSITORY_PORT');
