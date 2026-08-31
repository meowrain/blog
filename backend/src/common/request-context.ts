import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runInRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

const REQUEST_ID_MAX_LENGTH = 128;

/**
 * A client controls `x-request-id`, so it is reduced to a safe alphabet before it
 * reaches both the response header and the logs; otherwise it could smuggle ANSI
 * escapes or fake log lines into the terminal.
 */
export function sanitizeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const cleaned = value.replace(/[^A-Za-z0-9._\-]/g, '').slice(0, REQUEST_ID_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : undefined;
}
