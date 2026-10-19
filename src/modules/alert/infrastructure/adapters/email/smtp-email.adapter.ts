import { Injectable, Logger, LoggerService } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import {
  NotificationContent,
  NotificationPort,
  NotificationRecipient,
} from '../../../domain/ports/notification.port';

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly user?: string;
  readonly pass?: string;
  readonly from: string;
  readonly secure: boolean;
}

export interface SmtpEmailAdapterOptions {
  readonly config: SmtpConfig;
  readonly transporter?: Transporter;
  readonly logger?: LoggerService;
}

@Injectable()
export class SmtpEmailAdapter implements NotificationPort {
  private readonly config: SmtpConfig;
  private readonly transporter: Transporter;
  private readonly logger: LoggerService;

  constructor(options: SmtpEmailAdapterOptions) {
    this.config = options.config;
    this.logger = options.logger ?? new Logger(SmtpEmailAdapter.name);

    if (options.transporter) {
      this.transporter = options.transporter;
    } else {
      const hasAuth = Boolean(this.config.user && this.config.pass);
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        ...(hasAuth
          ? {
              auth: {
                user: this.config.user,
                pass: this.config.pass,
              },
            }
          : {}),
      });
    }
  }

  async send(to: NotificationRecipient, content: NotificationContent): Promise<void> {
    const recipient = to.name
      ? `"${to.name.replace(/"/g, '')}" <${to.email}>`
      : to.email;

    try {
      await this.transporter.sendMail({
        from: this.config.from,
        to: recipient,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });

      this.logger.log(`[SmtpEmailAdapter] Email sent to ${recipient}: "${content.subject}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`[SmtpEmailAdapter] Failed to send email to ${recipient}: ${message}`);
      throw error;
    }
  }

  getTransporter(): Transporter {
    return this.transporter;
  }
}
