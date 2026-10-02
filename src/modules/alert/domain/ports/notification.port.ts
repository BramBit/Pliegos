import { ProfileId } from '../../../shared/domain/typed-id';

export type NotificationChannel = 'email'; // only channel in Phase 1

export interface NotificationPort {
  send(profileId: ProfileId, message: string, channel: NotificationChannel): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
