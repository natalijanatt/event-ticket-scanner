import type { ApiError as ApiErrorBody } from '@event-platform/shared';

// HTTP client for the REST API.
//
//  • Authentication lives in HTTP-only cookies – this code never sees, stores
//    or sends a token. Nothing is written to localStorage.
//  • Every unsafe request carries the CSRF header the API requires.
//  • A 401 triggers ONE silent session refresh (shared by all concurrent
//    requests) and a single retry of the original call.

const BASE = `${import.meta.env.VITE_API_URL ?? ''}/api`;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never produced an HTTP response (offline, timeout, DNS, server down). */
export class NetworkError extends Error {
  constructor(message = 'Nema veze sa serverom. Proveri internet konekciju i pokušaj ponovo.') {
    super(message);
    this.name = 'NetworkError';
  }
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
/** Called when the session is definitely gone (refresh failed). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRF-Protection': '1' },
      });
      // 409 = another tab rotated the session a moment ago; its cookies are already ours.
      return res.ok || res.status === 409;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshInFlight = null), 0);
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  signal?: AbortSignal;
  /** Abort and raise NetworkError after this many milliseconds. */
  timeoutMs?: number;
  /** Do not attempt a session refresh on 401 (auth endpoints). */
  skipRefresh?: boolean;
  raw?: boolean;
}

async function send(method: string, path: string, body: unknown, opts: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  if (method !== 'GET') headers['X-CSRF-Protection'] = '1';

  const controller = new AbortController();
  const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : undefined;
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(`${BASE}${path}`, { method, headers, body: payload, credentials: 'include', signal: controller.signal });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new NetworkError();
  } finally {
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

async function toError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> = {};
  try {
    body = (await res.json()) as Partial<ApiErrorBody>;
  } catch {
    /* non-JSON error (proxy, gateway) */
  }
  if (res.status >= 502 && res.status <= 504 && !body.code) {
    return new ApiError(res.status, 'SERVER_UNAVAILABLE', 'Server trenutno nije dostupan. Pokušaj ponovo za koji trenutak.');
  }
  return new ApiError(res.status, body.code ?? 'ERROR', body.message ?? 'Došlo je do greške. Pokušaj ponovo.', body.fieldErrors);
}

export async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  let res = await send(method, path, body, opts);
  if (res.status === 401 && !opts.skipRefresh) {
    if (await refreshSession()) {
      res = await send(method, path, body, opts);
    }
    if (res.status === 401) {
      unauthorizedListeners.forEach((l) => l());
      throw await toError(res);
    }
  }
  if (!res.ok) throw await toError(res);
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, undefined, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, body ?? {}, opts),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body ?? {}, opts),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, body ?? {}, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, undefined, opts),
  upload: <T>(path: string, form: FormData, opts?: RequestOptions) => request<T>('POST', path, form, opts),
};

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof NetworkError) return err.message;
  return 'Došlo je do neočekivane greške. Pokušaj ponovo.';
}
