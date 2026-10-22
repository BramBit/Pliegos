import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable, NestMiddleware } from '@nestjs/common';

export const REQUEST_ID_HEADER = 'x-request-id';

export const requestIdStorage = new AsyncLocalStorage<string>();

export function getRequestId(): string {
  return requestIdStorage.getStore() || 'system';
}

export interface RequestWithId {
  requestId?: string;
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
}

export function resolveRequestId(req: RequestWithId): string {
  if (req.requestId && req.requestId.trim() !== '') {
    return req.requestId;
  }
  const incoming =
    req.headers?.[REQUEST_ID_HEADER] ?? req.headers?.['X-Request-Id'];
  const raw = Array.isArray(incoming) ? incoming[0] : incoming;
  const requestId = raw && raw.trim() !== '' ? raw.trim() : randomUUID();
  req.requestId = requestId;
  return requestId;
}

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(
    req: RequestWithId,
    res: { setHeader(name: string, value: string): void },
    next: () => void,
  ) {
    const requestId = resolveRequestId(req);
    res.setHeader('X-Request-Id', requestId);
    requestIdStorage.run(requestId, () => {
      next();
    });
  }
}
