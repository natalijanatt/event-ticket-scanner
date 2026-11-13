import type { AuthUser } from '@event-platform/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { GuestOnly, RequireAuth } from '@/auth/auth-context';
import { mockApi, renderApp } from '@/test/utils';
import { LoginPage } from './login-page';

const organizer: AuthUser = { id: 'u1', email: 'marko@example.com', firstName: 'Marko', lastName: 'Petrović', role: 'ORGANIZER', organizers: [{ id: 'o1', name: 'Club Central', role: 'OWNER' }] };
const scannerUser: AuthUser = { ...organizer, id: 'u2', role: 'SCANNER', organizers: [{ id: 'o1', name: 'Club Central', role: 'SCANNER' }] };

const unauthenticated = { path: '/auth/me', status: 401, body: { statusCode: 401, code: 'UNAUTHORIZED', message: 'Prijavi se da nastaviš.' } };
const noRefresh = { method: 'POST', path: '/auth/refresh', status: 401, body: { statusCode: 401, code: 'SESSION_EXPIRED', message: 'Sesija je istekla.' } };

const landing = (
  <>
    <Route path="/dashboard" element={<h1>Kontrolna tabla</h1>} />
    <Route path="/scanner" element={<h1>Skener</h1>} />
  </>
);

async function fillAndSubmit(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email adresa'), email);
  await user.type(screen.getByLabelText('Lozinka'), password);
  await user.click(screen.getByRole('button', { name: 'Prijavi se' }));
}

describe('authentication flow', () => {
  it('signs an organizer in and opens the dashboard', async () => {
    const calls = mockApi([unauthenticated, noRefresh, { method: 'POST', path: '/auth/login', body: organizer }]);
    renderApp(<LoginPage />, { route: '/login', path: '/login', extraRoutes: landing });

    await fillAndSubmit('Marko@Example.com', 'Demo-lozinka-2026');

    expect(await screen.findByRole('heading', { name: 'Kontrolna tabla' })).toBeInTheDocument();
    const login = calls.find((c) => c.path === '/auth/login');
    // The e-mail is normalized by the shared schema; the CSRF header is always sent.
    expect(login?.body).toEqual({ email: 'marko@example.com', password: 'Demo-lozinka-2026' });
    expect(login?.headers['X-CSRF-Protection']).toBe('1');
  });

  it('sends entrance staff straight to the scanner', async () => {
    mockApi([unauthenticated, noRefresh, { method: 'POST', path: '/auth/login', body: scannerUser }]);
    renderApp(<LoginPage />, { route: '/login', path: '/login', extraRoutes: landing });
    await fillAndSubmit('nikola@example.com', 'Demo-lozinka-2026');
    expect(await screen.findByRole('heading', { name: 'Skener' })).toBeInTheDocument();
  });

  it('shows the server message for wrong credentials and stays on the page', async () => {
    mockApi([unauthenticated, noRefresh, { method: 'POST', path: '/auth/login', status: 401, body: { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'Pogrešna email adresa ili lozinka.' } }]);
    renderApp(<LoginPage />, { route: '/login', path: '/login', extraRoutes: landing });
    await fillAndSubmit('marko@example.com', 'pogresna');
    expect(await screen.findByRole('alert')).toHaveTextContent('Pogrešna email adresa ili lozinka.');
    expect(screen.getByRole('heading', { name: 'Prijava' })).toBeInTheDocument();
  });

  it('validates the form before calling the API', async () => {
    const calls = mockApi([unauthenticated, noRefresh]);
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Email adresa'), 'nije-email');
    await user.click(screen.getByRole('button', { name: 'Prijavi se' }));
    expect(await screen.findByText('Unesi ispravnu email adresu.')).toBeInTheDocument();
    expect(screen.getByText('Lozinka je obavezna.')).toBeInTheDocument();
    expect(calls.some((c) => c.path === '/auth/login')).toBe(false);
  });

  it('reports a connection problem in plain language', async () => {
    mockApi([unauthenticated, noRefresh, { method: 'POST', path: '/auth/login', networkError: true }]);
    renderApp(<LoginPage />, { route: '/login', path: '/login' });
    await fillAndSubmit('marko@example.com', 'Demo-lozinka-2026');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nema veze sa serverom/);
  });
});

describe('route protection', () => {
  const routes = (
    <>
      <Route path="/login" element={<h1>Prijava</h1>} />
      <Route path="/scanner" element={<h1>Skener</h1>} />
      <Route path="/dashboard" element={<h1>Kontrolna tabla</h1>} />
    </>
  );

  it('redirects an unauthenticated visitor to the login page', async () => {
    mockApi([unauthenticated, noRefresh]);
    renderApp(<RequireAuth roles={['SUPER_ADMIN', 'ORGANIZER']} />, { route: '/events', path: '/events', extraRoutes: routes });
    expect(await screen.findByRole('heading', { name: 'Prijava' })).toBeInTheDocument();
  });

  it('keeps entrance staff out of the admin panel', async () => {
    mockApi([{ path: '/auth/me', body: scannerUser }]);
    renderApp(<RequireAuth roles={['SUPER_ADMIN', 'ORGANIZER']} />, { route: '/events', path: '/events', extraRoutes: routes });
    expect(await screen.findByRole('heading', { name: 'Skener' })).toBeInTheDocument();
  });

  it('skips the login page for a signed-in user', async () => {
    mockApi([{ path: '/auth/me', body: organizer }]);
    renderApp(<GuestOnly />, { route: '/login', path: '/login', extraRoutes: <Route path="/dashboard" element={<h1>Kontrolna tabla</h1>} /> });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Kontrolna tabla' })).toBeInTheDocument());
  });
});
