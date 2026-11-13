import type { AuthUser, LoginInput, UserRole } from '@event-platform/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui/controls';
import { api, ApiError, onUnauthorized } from '@/lib/api';

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the first "who am I" request settles. */
  loading: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

const ME_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();

  // The session lives in HTTP-only cookies; asking the API is the only way
  // the browser can learn whether someone is signed in.
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: async (): Promise<AuthUser | null> => {
      try {
        return await api.get<AuthUser>('/auth/me');
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });

  React.useEffect(
    () =>
      onUnauthorized(() => {
        // Session ended elsewhere (expired, revoked, signed out in another tab).
        queryClient.setQueryData(ME_KEY, null);
      }),
    [queryClient],
  );

  const value = React.useMemo<AuthContextValue>(
    () => ({
      user: me.data ?? null,
      loading: me.isPending,
      login: async (input) => {
        const user = await api.post<AuthUser>('/auth/login', input, { skipRefresh: true });
        // Update the identity query in place (its observers must stay attached),
        // then drop every other cached query so no data of a previous user survives.
        queryClient.setQueryData(ME_KEY, user);
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        return user;
      },
      logout: async () => {
        try {
          await api.post('/auth/logout', undefined, { skipRefresh: true });
        } finally {
          queryClient.setQueryData(ME_KEY, null);
          queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
        }
      },
      setUser: (user) => queryClient.setQueryData(ME_KEY, user),
    }),
    [me.data, me.isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in user; only call below <RequireAuth>. */
export function useUser(): AuthUser {
  const { user } = useAuth();
  if (!user) throw new Error('useUser requires an authenticated user');
  return user;
}

/** Where each role lands after signing in. */
export function homePathFor(role: UserRole): string {
  return role === 'SCANNER' ? '/scanner' : '/dashboard';
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <Spinner className="size-6" />
    </div>
  );
}

/**
 * Route guard. Unauthenticated visitors go to /login (remembering where they
 * were headed); authenticated users without the required role go to their
 * own home. The API enforces the same rules – this only keeps the UI honest.
 */
export function RequireAuth({ roles }: { roles?: UserRole[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homePathFor(user.role)} replace />;
  return <Outlet />;
}

/** Keeps signed-in users away from the login/reset screens. */
export function GuestOnly() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  if (user) return <Navigate to={homePathFor(user.role)} replace />;
  return <Outlet />;
}
