import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  LoggerService,
  Optional,
  Inject,
} from '@nestjs/common';
import {
  AlertNotFoundError,
  OpportunityNotFoundError,
  ProfileNotFoundError,
  RecommendationNotFoundError,
  SourceUnavailableError,
  ValidationError,
} from '../../domain/errors';
import { RequestWithId, resolveRequestId } from './request-id.middleware';

export type DomainError =
  | ValidationError
  | ProfileNotFoundError
  | OpportunityNotFoundError
  | RecommendationNotFoundError
  | AlertNotFoundError
  | SourceUnavailableError;

export interface ErrorEnvelope {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly details?: unknown;
  readonly errors?: unknown;
  readonly requestId: string;
}

export class DomainErrorException extends Error {
  constructor(public readonly domainError: DomainError) {
    super(
      'message' in domainError && domainError.message
        ? domainError.message
        : domainError.type,
    );
    this.name = 'DomainErrorException';
  }
}

function isDomainErrorObject(value: unknown): value is DomainError {
  if (!value || typeof value !== 'object') return false;
  const maybeType = (value as { type?: unknown }).type;
  return (
    maybeType === 'ValidationError' ||
    maybeType === 'ProfileNotFoundError' ||
    maybeType === 'OpportunityNotFoundError' ||
    maybeType === 'RecommendationNotFoundError' ||
    maybeType === 'AlertNotFoundError' ||
    maybeType === 'SourceUnavailableError'
  );
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger: LoggerService;

  constructor(
    @Optional() @Inject('EXCEPTION_FILTER_LOGGER') logger?: LoggerService,
  ) {
    this.logger = logger ?? new Logger(GlobalExceptionFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<RequestWithId>();
    const res = ctx.getResponse<{
      setHeader(name: string, value: string): void;
      status(code: number): { json(body: ErrorEnvelope): void };
    }>();

    const requestId = resolveRequestId(req);
    res.setHeader('X-Request-Id', requestId);

    const mapped = this.mapException(exception, requestId);

    const internalReason =
      exception instanceof Error
        ? exception.message
        : typeof exception === 'string'
          ? exception
          : mapped.message;

    const logMessage = `[requestId=${requestId}] ${req.method ?? 'HTTP'} ${req.originalUrl ?? req.url ?? ''} -> ${mapped.statusCode} ${mapped.error}: ${internalReason}`;

    if (mapped.statusCode >= 400 && mapped.statusCode < 500) {
      this.logger.warn(logMessage);
    } else {
      this.logger.error(logMessage);
    }

    res.status(mapped.statusCode).json(mapped);
  }

  private mapException(exception: unknown, requestId: string): ErrorEnvelope {
    const domainErr =
      exception instanceof DomainErrorException
        ? exception.domainError
        : isDomainErrorObject(exception)
          ? exception
          : null;

    if (domainErr) {
      switch (domainErr.type) {
        case 'ValidationError':
          return {
            statusCode: HttpStatus.BAD_REQUEST,
            error: 'ValidationError',
            message:
              typeof domainErr.message === 'string' &&
              domainErr.message.length > 0
                ? domainErr.message
                : 'Validation failed',
            ...(domainErr.fields !== undefined
              ? { details: domainErr.fields }
              : {}),
            requestId,
          };
        case 'ProfileNotFoundError':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            error: 'ProfileNotFoundError',
            message: `Perfil no encontrado: ${String(domainErr.profileId ?? '')}`,
            requestId,
          };
        case 'OpportunityNotFoundError':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            error: 'OpportunityNotFoundError',
            message: `Oportunidad no encontrada: ${String(domainErr.opportunityId ?? '')}`,
            requestId,
          };
        case 'RecommendationNotFoundError':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            error: 'RecommendationNotFoundError',
            message: `Recomendación no encontrada: ${String(domainErr.recommendationId ?? '')}`,
            requestId,
          };
        case 'AlertNotFoundError':
          return {
            statusCode: HttpStatus.NOT_FOUND,
            error: 'AlertNotFoundError',
            message: `Alerta no encontrada: ${String(domainErr.alertId ?? '')}`,
            requestId,
          };
        case 'SourceUnavailableError':
          return {
            statusCode: HttpStatus.BAD_GATEWAY,
            error: 'SourceUnavailableError',
            message: `Fuente de contratación no disponible: ${String(domainErr.sourceName ?? '')}`,
            requestId,
          };
      }
    }

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const rawResponse = exception.getResponse();

      if (typeof rawResponse === 'object' && rawResponse !== null) {
        const body = rawResponse as Record<string, unknown>;
        const details = body.details ?? body.errors ?? body.fields;
        const message = Array.isArray(body.message)
          ? body.message.join('; ')
          : typeof body.message === 'string'
            ? body.message
            : exception.message;
        const errorName =
          typeof body.error === 'string' && body.error.length > 0
            ? body.error
            : this.defaultErrorLabel(statusCode);

        return {
          statusCode,
          error: errorName,
          message,
          ...(details !== undefined ? { details } : {}),
          ...(body.errors !== undefined ? { errors: body.errors } : {}),
          requestId,
        };
      }

      return {
        statusCode,
        error: this.defaultErrorLabel(statusCode),
        message:
          typeof rawResponse === 'string' ? rawResponse : exception.message,
        requestId,
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'InternalServerError',
      message: 'An unexpected error occurred',
      requestId,
    };
  }

  private defaultErrorLabel(statusCode: number): string {
    switch (statusCode) {
      case HttpStatus.BAD_REQUEST:
        return 'ValidationError';
      case HttpStatus.UNAUTHORIZED:
        return 'UnauthorizedError';
      case HttpStatus.FORBIDDEN:
        return 'ForbiddenError';
      case HttpStatus.NOT_FOUND:
        return 'NotFoundError';
      case HttpStatus.BAD_GATEWAY:
        return 'SourceUnavailableError';
      default:
        return 'InternalServerError';
    }
  }
}
