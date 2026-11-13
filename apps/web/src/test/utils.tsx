import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import type * as React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@/auth/auth-context';
import { TooltipProvider } from '@/components/ui/controls';

interface MockRoute {
  method?: string;
  /** Matched against the path after `/api`. */
  path: string | RegExp;
  status?: number;
  body?: unknown;
  /** Reject like a dropped connection. */
  networkError?: boolean;
}

export interface FetchCall {
  method: string;
  path: string;
  body: unknown;
  headers: Record<string, string>;
}

/**
 * Replaces `fetch` with a small in-memory API. Unmatched requests answer 404
 * so a test never silently talks to a real server. Returns the recorded calls.
 */
export function mockApi(routes: MockRoute[]): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname.replace(/^\/api/, '') + url.search;
      const method = (init?.method ?? 'GET').toUpperCase();
      let body: unknown;
      if (typeof init?.body === 'string') {
        try {
          body = JSON.parse(init.body);
        } catch {
          body = init.body;
        }
      }
      calls.push({ method, path, body, headers: (init?.headers ?? {}) as Record<string, string> });

      const route = routes.find((r) => (r.method ?? 'GET') === method && (typeof r.path === 'string' ? r.path === path : r.path.test(path)));
      if (route?.networkError) throw new TypeError('Failed to fetch');
      const status = route ? (route.status ?? 200) : 404;
      const payload = route ? route.body : { statusCode: 404, code: 'NOT_FOUND', message: 'Traženi podatak nije pronađen.' };
      return new Response(payload === undefined ? null : JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

interface RenderOptions {
  route?: string;
  /** Route pattern the element is mounted at (for pages that read URL params). */
  path?: string;
  /** Extra routes, e.g. a landing page to assert navigation. */
  extraRoutes?: React.ReactNode;
}

export function renderApp(ui: React.ReactElement, { route = '/', path = '*', extraRoutes }: RenderOptions = {}): RenderResult {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <TooltipProvider>
            <Routes>
              <Route path={path} element={ui} />
              {extraRoutes}
            </Routes>
          </TooltipProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
