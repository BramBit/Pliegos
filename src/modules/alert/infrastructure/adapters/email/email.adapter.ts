import { Injectable, Logger, LoggerService } from '@nestjs/common';
import { NotificationPort, NotificationChannel } from '../../../domain/ports/notification.port';
import { ProfileId } from '../../../../shared/domain/typed-id';

export interface SentEmailNotification {
  readonly profileId: ProfileId;
  readonly message: string;
  readonly sentAt: Date;
}

export interface EmailAdapterOptions {
  readonly logger?: LoggerService;
  readonly onSend?: (notification: SentEmailNotification) => Promise<void> | void;
}

@Injectable()
export class EmailAdapter implements NotificationPort {
  private readonly logger: LoggerService;
  private readonly sentNotifications: SentEmailNotification[] = [];
  private readonly onSend?: (notification: SentEmailNotification) => Promise<void> | void;

  constructor(options?: EmailAdapterOptions) {
    this.logger = options?.logger ?? new Logger(EmailAdapter.name);
    this.onSend = options?.onSend;
  }

  /**
   * Dispatches an email notification to the recipient associated with the profile.
   */
  async send(profileId: ProfileId, message: string, channel: NotificationChannel): Promise<void> {
    if (channel !== 'email') {
      throw new Error(`EmailAdapter only supports 'email' channel, received '${channel}'`);
    }

    const notification: SentEmailNotification = {
      profileId,
      message,
      sentAt: new Date(),
    };

    this.sentNotifications.push(notification);
    this.logger.log(`[EmailAdapter] Notification sent to Profile ${profileId}: "${message}"`);

    if (this.onSend) {
      await this.onSend(notification);
    }
  }

  /**
   * Returns a copy of all recorded email notifications sent during this runtime.
   */
  getSentNotifications(): SentEmailNotification[] {
    return [...this.sentNotifications];
  }

  /**
   * Clears the sent notifications buffer.
   */
  clear(): void {
    this.sentNotifications.length = 0;
  }
}
