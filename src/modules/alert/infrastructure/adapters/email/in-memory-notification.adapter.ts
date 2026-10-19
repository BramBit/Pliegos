import { Injectable, Logger, LoggerService } from '@nestjs/common';
import {
  NotificationContent,
  NotificationPort,
  NotificationRecipient,
} from '../../../domain/ports/notification.port';

export interface SentNotificationRecord {
  readonly to: NotificationRecipient;
  readonly content: NotificationContent;
  readonly sentAt: Date;
}

export interface InMemoryNotificationAdapterOptions {
  readonly logger?: LoggerService;
  readonly onSend?: (notification: SentNotificationRecord) => Promise<void> | void;
}

@Injectable()
export class InMemoryNotificationAdapter implements NotificationPort {
  private readonly logger: LoggerService;
  private readonly sentNotifications: SentNotificationRecord[] = [];
  private readonly onSend?: (notification: SentNotificationRecord) => Promise<void> | void;

  constructor(options?: InMemoryNotificationAdapterOptions) {
    this.logger = options?.logger ?? new Logger(InMemoryNotificationAdapter.name);
    this.onSend = options?.onSend;
  }

  async send(to: NotificationRecipient, content: NotificationContent): Promise<void> {
    const notification: SentNotificationRecord = {
      to,
      content,
      sentAt: new Date(),
    };

    this.sentNotifications.push(notification);
    this.logger.log(
      `[InMemoryNotificationAdapter] Sent to ${to.email} (${to.name ?? 'unnamed'}): "${content.subject}"`,
    );

    if (this.onSend) {
      await this.onSend(notification);
    }
  }

  getSentNotifications(): SentNotificationRecord[] {
    return [...this.sentNotifications];
  }

  clear(): void {
    this.sentNotifications.length = 0;
  }
}
