import type { AuthUser, DashboardDto } from '@event-platform/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
import { App } from './App';
import { AuthProvider } from './auth/auth-context';
import { TooltipProvider } from './components/ui/controls';
import { mockApi } from './test/utils';

const user: AuthUser = { id: 'u1', email: 'marko@example.com', firstName: 'Marko', lastName: 'Petrović', role: 'ORGANIZER', organizers: [{ id: 'o1', name: 'Club Central', role: 'OWNER' }] };
const dashboard: DashboardDto = {
  totals: { events: 0, activeEvents: 0, guests: 0, tickets: 0, checkedIn: 0, invitationsSent: 0 },
  upcoming: [],
  recent: [],
  recentCheckIns: [],
};

// Regression: the whole app with its real route guards. Signing in must land
// on the dashboard – the guards have to see the new user immediately.
it('signs in through the real router and lands on the dashboard', async () => {
  const calls = mockApi([
    { method: 'POST', path: '/auth/refresh', status: 401, body: {} },
    { method: 'POST', path: '/auth/login', body: user },
    { path: '/dashboard', body: dashboard },
  ]);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  const ui = userEvent.setup();
  await ui.type(await screen.findByLabelText('Email adresa', {}, { timeout: 5000 }), 'marko@example.com');
  await ui.type(screen.getByLabelText('Lozinka'), 'Demo-lozinka-2026');
  await ui.click(screen.getByRole('button', { name: 'Prijavi se' }));

  expect(await screen.findByRole('heading', { name: 'Zdravo, Marko' }, { timeout: 8000 })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Glavna navigacija' })).toBeInTheDocument();
  expect(calls.some((c) => c.path === '/dashboard')).toBe(true);

  // Signing out returns to the login screen.
  calls.length = 0;
  await ui.click(screen.getAllByRole('button', { name: 'Odjavi se' })[0]);
  expect(await screen.findByRole('heading', { name: 'Prijava' }, { timeout: 5000 })).toBeInTheDocument();
}, 30_000);
