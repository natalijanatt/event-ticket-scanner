import { Activity, ArrowRight, Send, UserPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { EmptyState, ErrorState, Section, Stat, StatGrid } from '@/components/ui/states';
import { formatDateWithWeekday, formatNumber, formatPercent, formatRelative, formatTime } from '@/lib/format';
import { useEventContext, useEventStats } from '../event-queries';

/** Thin progress bar; the fill is the only colored element on the page. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} className="h-2 w-full overflow-hidden rounded-full bg-subtle">
      <div className="h-full rounded-full bg-success transition-[width] duration-500" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function EventOverviewTab() {
  const { event } = useEventContext();
  const stats = useEventStats(event.id);

  if (stats.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }
  if (stats.isError) return <ErrorState error={stats.error} onRetry={() => stats.refetch()} />;

  const s = stats.data;
  const invited = s.invitations.SENT + s.invitations.DELIVERED;
  const failed = s.invitations.BOUNCED + s.invitations.FAILED;
  const active = s.tickets.valid + s.tickets.used;
  const isEmpty = s.guests.total === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={UserPlus}
        title="Događaj je spreman — dodaj goste"
        description="Unesi goste ručno ili uvezi listu, pa im pošalji pozivnice sa QR ulaznicama. Ovde ćeš pratiti slanje i ulaske uživo."
        action={
          <Button asChild>
            <Link to="guests">
              <UserPlus /> Dodaj goste
            </Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <StatGrid>
        <Stat label="Pozvani gosti" value={formatNumber(s.guests.total)} hint={`${formatNumber(s.tickets.allocated)} dodeljenih karata`} />
        <Stat label="Generisane karte" value={formatNumber(active)} hint={s.tickets.revoked > 0 ? `+ ${formatNumber(s.tickets.revoked)} poništenih` : 'važeće i iskorišćene'} />
        <Stat
          label="Poslate pozivnice"
          value={formatNumber(invited)}
          hint={`${formatNumber(s.invitations.DELIVERED)} sa potvrđenom isporukom`}
        />
        <Stat label="Neuspela slanja" value={formatNumber(failed)} tone={failed > 0 ? 'danger' : 'default'} hint={failed > 0 ? 'proveri adrese' : 'nema grešaka'} />
        <Stat label="Ušlo" value={formatNumber(s.tickets.used)} tone="success" hint={`${formatPercent(s.checkInRate)} karata · ${formatNumber(s.guests.checkedIn)} gostiju`} />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section
          title="Ulasci uživo"
          description="Lista se osvežava sama kako osoblje skenira karte."
          actions={
            <Button asChild variant="ghost" size="sm">
              <Link to="check-ins">
                Svi ulasci <ArrowRight />
              </Link>
            </Button>
          }
          bodyClassName="p-0"
        >
          <div className="space-y-2 border-b border-line px-5 py-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-ink-muted">{s.capacity ? 'Popunjenost prostora' : 'Iskorišćene karte'}</span>
              <span className="tabular font-semibold">
                {formatNumber(s.tickets.used)} / {formatNumber(s.capacity ?? active)}
              </span>
            </div>
            <Meter value={s.tickets.used} max={s.capacity ?? active} label={s.capacity ? 'Popunjenost prostora' : 'Iskorišćene karte'} />
          </div>
          {s.recentCheckIns.length === 0 ? (
            <EmptyState bare icon={Activity} title="Još nema ulazaka" description="Prvi skenirani gosti pojaviće se ovde." className="py-10" />
          ) : (
            <ul>
              {s.recentCheckIns.slice(0, 8).map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 last:border-b-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{c.guestName}</div>
                    <TicketTypeTag name={c.ticketType.name} color={c.ticketType.color} className="text-[13px] text-ink-muted" />
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular text-sm font-medium">{formatTime(c.usedAt)}</div>
                    <div className="text-xs text-ink-faint">{formatRelative(c.usedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="space-y-6">
          <Section title="Sledeći koraci">
            <ul className="space-y-3 text-sm">
              {s.invitations.NOT_SENT > 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>
                    <strong className="tabular font-semibold">{formatNumber(s.invitations.NOT_SENT)}</strong> gostiju još nije dobilo pozivnicu.
                  </span>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="guests">
                      <Send /> Pošalji
                    </Link>
                  </Button>
                </li>
              )}
              {failed > 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>
                    <strong className="tabular font-semibold text-danger">{formatNumber(failed)}</strong> pozivnica nije isporučeno.
                  </span>
                  <Button asChild size="sm" variant="secondary">
                    <Link to="invitations">Pogledaj</Link>
                  </Button>
                </li>
              )}
              {s.invitations.NOT_SENT === 0 && failed === 0 && <li className="text-ink-muted">Sve pozivnice su poslate. Na dan događaja otvori skener na telefonu.</li>}
            </ul>
          </Section>

          <Section title="Detalji">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-ink-muted">Početak</dt>
                <dd className="font-medium">
                  {formatDateWithWeekday(event.startsAt)} u {formatTime(event.startsAt)}
                </dd>
              </div>
              {event.endsAt && (
                <div>
                  <dt className="text-ink-muted">Kraj</dt>
                  <dd className="font-medium">
                    {formatDateWithWeekday(event.endsAt)} u {formatTime(event.endsAt)}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-ink-muted">Lokacija</dt>
                <dd className="font-medium">{event.venueName}</dd>
                {event.venueAddress && <dd className="text-ink-muted">{event.venueAddress}</dd>}
              </div>
              <div>
                <dt className="text-ink-muted">Kapacitet</dt>
                <dd className="font-medium">
                  {event.capacity ? `${formatNumber(event.capacity)} osoba${event.enforceCapacity ? ' · ulaz se zaustavlja kada se popuni' : ''}` : 'Bez ograničenja'}
                </dd>
              </div>
              {event.description && (
                <div>
                  <dt className="text-ink-muted">Opis</dt>
                  <dd className="whitespace-pre-line leading-relaxed">{event.description}</dd>
                </div>
              )}
            </dl>
          </Section>
        </div>
      </div>
    </div>
  );
}
