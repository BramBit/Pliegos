import { Injectable, LoggerService } from '@nestjs/common';
import { getRequestId } from '../http/request-id.middleware';
import { redact, redactString } from './redaction';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  requestId: string;
  data?: unknown;
  stack?: string;
}

@Injectable()
export class StructuredLoggerService implements LoggerService {
  private readonly isProduction: boolean;
  private readonly configuredLevel: LogLevel;

  constructor(options?: { nodeEnv?: string; logLevel?: LogLevel }) {
    this.isProduction = (options?.nodeEnv ?? 'development') === 'production';
    const envLevel = (options?.logLevel ?? 'info').toLowerCase() as LogLevel;
    this.configuredLevel = LOG_LEVEL_SEVERITY[envLevel] !== undefined ? envLevel : 'info';
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= LOG_LEVEL_SEVERITY[this.configuredLevel];
  }

  private formatMessage(level: LogLevel, message: any, ...optionalParams: any[]): void {
    if (!this.shouldLog(level)) return;

    let context: string | undefined;
    let data: unknown;
    let stack: string | undefined;

    if (optionalParams.length > 0) {
      const lastParam = optionalParams[optionalParams.length - 1];
      if (typeof lastParam === 'string' && optionalParams.length === 1) {
        context = lastParam;
      } else if (level === 'error' && typeof optionalParams[0] === 'string' && optionalParams.length >= 2) {
        stack = optionalParams[0];
        context = optionalParams[1];
      } else {
        data = optionalParams.length === 1 ? optionalParams[0] : optionalParams;
      }
    }

    const currentRequestId = getRequestId();

    const rawMessage = typeof message === 'string' ? message : JSON.stringify(message);
    const cleanedMessage = redactString(rawMessage);
    const cleanedData = data ? redact(data) : undefined;
    const cleanedStack = stack ? redactString(stack) : undefined;

    if (this.isProduction) {
      const entry: StructuredLogEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: cleanedMessage,
        context,
        requestId: currentRequestId,
        ...(cleanedData !== undefined && { data: cleanedData }),
        ...(cleanedStack && { stack: cleanedStack }),
      };

      const json = JSON.stringify(entry);
      if (level === 'error') {
        process.stderr.write(`${json}\n`);
      } else {
        process.stdout.write(`${json}\n`);
      }
    } else {
      const ctxPrefix = context ? `[${context}] ` : '';
      const reqPrefix = `[req=${currentRequestId}] `;
      const output = `${new Date().toISOString()} [${level.toUpperCase()}] ${reqPrefix}${ctxPrefix}${cleanedMessage}`;
      if (level === 'error') {
        console.error(output, cleanedData ?? '', cleanedStack ?? '');
      } else if (level === 'warn') {
        console.warn(output, cleanedData ?? '');
      } else {
        console.log(output, cleanedData ?? '');
      }
    }
  }

  log(message: any, ...optionalParams: any[]): void {
    this.formatMessage('info', message, ...optionalParams);
  }

  error(message: any, ...optionalParams: any[]): void {
    this.formatMessage('error', message, ...optionalParams);
  }

  warn(message: any, ...optionalParams: any[]): void {
    this.formatMessage('warn', message, ...optionalParams);
  }

  debug(message: any, ...optionalParams: any[]): void {
    this.formatMessage('debug', message, ...optionalParams);
  }

  verbose(message: any, ...optionalParams: any[]): void {
    this.formatMessage('debug', message, ...optionalParams);
  }
}
