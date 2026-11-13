import type { DashboardDto } from '@event-platform/shared';
import { useQuery } from '@tanstack/react-query';
import { Activity, CalendarPlus, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useUser } from '@/auth/auth-context';
import { TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { EmptyState, ErrorState, PageHeader, Section, Stat, StatGrid } from '@/components/ui/states';
import { api } from '@/lib/api';
import { formatNumber, formatPercent, formatRelative, formatTime } from '@/lib/format';
import { EventRow } from './events/events-page';

export function DashboardPage() {
  const user = useUser();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardDto>('/dashboard'),
    // Lightweight polling keeps the overview live without a manual refresh.
    refetchInterval: 15_000,
  });

  const header = (
    <PageHeader
      title={`Zdravo, ${user.firstName}`}
      description="Stanje tvojih događaja u ovom trenutku."
      actions={
        <Button asChild>
          <Link to="/events/new">
            <Plus /> Novi događaj
          </Link>
        </Button>
      }
    />
  );

  if (dashboard.isPending) {
    return (
      <div className="space-y-6">
        {header}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (dashboard.isError) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState error={dashboard.error} onRetry={() => dashboard.refetch()} />
      </div>
    );
  }

  const d = dashboard.data;
  const t = d.totals;
  const rate = t.tickets > 0 ? (t.checkedIn / t.tickets) * 100 : 0;

  if (t.events === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          icon={CalendarPlus}
          title="Počni od prvog događaja"
          description="Kreiraj događaj, dodaj goste i pošalji im pozivnice sa QR ulaznicama. Na ulazu skeniraš telefonom."
          action={
            <Button asChild>
              <Link to="/events/new">
                <Plus /> Kreiraj događaj
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <StatGrid>
        <Stat label="Aktivni događaji" value={formatNumber(t.activeEvents)} hint={`od ukupno ${formatNumber(t.events)}`} />
        <Stat label="Pozvani gosti" value={formatNumber(t.guests)} />
        <Stat label="Izdate karte" value={formatNumber(t.tickets)} hint="bez poništenih" />
        <Stat label="Poslate pozivnice" value={formatNumber(t.invitationsSent)} />
        <Stat label="Ušlo" value={formatNumber(t.checkedIn)} tone="success" hint={`${formatPercent(rate)} karata`} />
      </StatGrid>

      {user.role === 'SUPER_ADMIN' && (
        <StatGrid className="sm:grid-cols-2 lg:grid-cols-2">
          <Stat label="Organizatori na platformi" value={formatNumber(t.organizers ?? 0)} />
          <Stat label="Aktivni korisnici" value={formatNumber(t.users ?? 0)} />
        </StatGrid>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <section aria-labelledby="dash-upcoming">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="dash-upcoming" className="eyebrow">
                Predstojeći i u toku
              </h2>
              <Link to="/events" className="text-[13px] font-semibold text-ink-muted hover:text-ink">
                Svi događaji
              </Link>
            </div>
            {d.upcoming.length === 0 ? (
              <EmptyState icon={CalendarPlus} title="Nema predstojećih događaja" description="Zakaži sledeći događaj da bi se pojavio ovde." className="py-10" />
            ) : (
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {d.upcoming.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            )}
          </section>
          {d.recent.length > 0 && (
            <section aria-labelledby="dash-recent">
              <h2 id="dash-recent" className="eyebrow mb-3">
                Nedavno završeni
              </h2>
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {d.recent.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}
        </div>

        <Section title="Poslednji ulasci" description="Sa svih tvojih događaja, uživo." bodyClassName="p-0">
          {d.recentCheckIns.length === 0 ? (
            <EmptyState bare icon={Activity} title="Još nema ulazaka" description="Skenirane karte će se pojaviti ovde." className="py-10" />
          ) : (
            <ul>
              {d.recentCheckIns.map((c) => (
                <li key={c.id} className="border-b border-line last:border-b-0">
                  <Link to={`/events/${c.eventId}/check-ins`} className="flex items-center justify-between gap-4 px-5 py-3 hover:bg-subtle/50">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{c.guestName}</div>
                      <div className="flex items-center gap-2 text-[13px] text-ink-muted">
                        <TicketTypeTag name={c.ticketType.name} color={c.ticketType.color} className="text-[13px]" />
                        <span className="truncate">· {c.eventName}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="tabular text-sm font-medium">{formatTime(c.usedAt)}</div>
                      <div className="text-xs text-ink-faint">{formatRelative(c.usedAt)}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
