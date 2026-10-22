export type NotificationChannel = 'email'; // only channel in Phase 1

export interface NotificationRecipient {
  readonly email: string;
  readonly name?: string | null;
}

export interface NotificationContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface NotificationPort {
  send(to: NotificationRecipient, content: NotificationContent): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
