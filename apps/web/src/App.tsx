import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { FullScreenLoader, GuestOnly, homePathFor, RequireAuth, useAuth } from './auth/auth-context';
import { AdminLayout } from './layouts/admin-layout';
import { AuthLayout } from './layouts/auth-layout';
import { ForgotPasswordPage } from './pages/auth/forgot-password-page';
import { LoginPage } from './pages/auth/login-page';
import { ResetPasswordPage } from './pages/auth/reset-password-page';
import { NotFoundPage } from './pages/not-found-page';

// Route-level code splitting: the admin panel, the scanner (camera + QR
// decoder) and the public ticket page are separate bundles, so a guest
// opening a ticket downloads none of the admin code.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lazy = <T extends Record<string, any>>(loader: () => Promise<T>, name: keyof T) =>
  React.lazy(async () => ({ default: (await loader())[name] as React.ComponentType }));

const DashboardPage = lazy(() => import('./pages/dashboard-page'), 'DashboardPage');
const EventsPage = lazy(() => import('./pages/events/events-page'), 'EventsPage');
const EventNewPage = lazy(() => import('./pages/events/event-new-page'), 'EventNewPage');
const EventLayout = lazy(() => import('./pages/events/event-layout'), 'EventLayout');
const EventOverviewTab = lazy(() => import('./pages/events/tabs/overview-tab'), 'EventOverviewTab');
const EventGuestsTab = lazy(() => import('./pages/events/tabs/guests-tab'), 'EventGuestsTab');
const EventTicketsTab = lazy(() => import('./pages/events/tabs/tickets-tab'), 'EventTicketsTab');
const EventInvitationsTab = lazy(() => import('./pages/events/tabs/invitations-tab'), 'EventInvitationsTab');
const EventCheckInsTab = lazy(() => import('./pages/events/tabs/check-ins-tab'), 'EventCheckInsTab');
const EventAnalyticsTab = lazy(() => import('./pages/events/tabs/analytics-tab'), 'EventAnalyticsTab');
const EventSettingsTab = lazy(() => import('./pages/events/tabs/settings-tab'), 'EventSettingsTab');
const StaffPage = lazy(() => import('./pages/staff-page'), 'StaffPage');
const SettingsPage = lazy(() => import('./pages/settings-page'), 'SettingsPage');
const OrganizersPage = lazy(() => import('./pages/admin/organizers-page'), 'OrganizersPage');
const UsersPage = lazy(() => import('./pages/admin/users-page'), 'UsersPage');
const ScannerPage = lazy(() => import('./pages/scanner/scanner-page'), 'ScannerPage');
const ScannerHistoryPage = lazy(() => import('./pages/scanner/scanner-history-page'), 'ScannerHistoryPage');
const TicketPage = lazy(() => import('./pages/ticket/ticket-page'), 'TicketPage');

function RootRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoader />;
  return <Navigate to={user ? homePathFor(user.role) : '/login'} replace />;
}

export function App() {
  return (
    <React.Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />

        {/* Guest ticket – public, reachable only through its unguessable link. */}
        <Route path="/t/:token" element={<TicketPage />} />

        <Route element={<GuestOnly />}>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
          </Route>
        </Route>

        {/* Administration – organizers and platform admins only. */}
        <Route element={<RequireAuth roles={['SUPER_ADMIN', 'ORGANIZER']} />}>
          <Route element={<AdminLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/events" element={<EventsPage />} />
            <Route path="/events/new" element={<EventNewPage />} />
            <Route path="/events/:eventId" element={<EventLayout />}>
              <Route index element={<EventOverviewTab />} />
              <Route path="guests" element={<EventGuestsTab />} />
              <Route path="tickets" element={<EventTicketsTab />} />
              <Route path="invitations" element={<EventInvitationsTab />} />
              <Route path="check-ins" element={<EventCheckInsTab />} />
              <Route path="analytics" element={<EventAnalyticsTab />} />
              <Route path="settings" element={<EventSettingsTab />} />
            </Route>
            <Route path="/staff" element={<StaffPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route element={<RequireAuth roles={['SUPER_ADMIN']} />}>
              <Route path="/organizers" element={<OrganizersPage />} />
              <Route path="/users" element={<UsersPage />} />
            </Route>
          </Route>
        </Route>

        {/* Entrance scanner – every signed-in role; events are filtered by the API. */}
        <Route element={<RequireAuth />}>
          <Route path="/scanner" element={<ScannerPage />} />
          <Route path="/scanner/history" element={<ScannerHistoryPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </React.Suspense>
  );
}
