import type { EventDto } from '@event-platform/shared';
import { CalendarPlus, CalendarX2, MapPin, Plus } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { EventStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented, Skeleton } from '@/components/ui/controls';
import { SearchInput } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader } from '@/components/ui/states';
import { dateParts, formatNumber, formatTime } from '@/lib/format';
import { useEvents } from './event-queries';

type View = 'active' | 'archived';

/** One event as a full-width row: date tile, identity, and the three numbers that matter. */
export function EventRow({ event }: { event: EventDto }) {
  const date = dateParts(event.startsAt);
  const rate = event.counts.tickets > 0 ? Math.round((event.counts.checkedIn / event.counts.tickets) * 100) : 0;
  return (
    <Link
      to={`/events/${event.id}`}
      className="group flex items-center gap-4 border-b border-line px-4 py-4 transition-colors last:border-b-0 hover:bg-subtle/50 sm:gap-5 sm:px-5"
    >
      <div className="flex w-14 shrink-0 flex-col items-center rounded-md border border-line bg-canvas py-1.5" aria-hidden>
        <span className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{date.month}</span>
        <span className="tabular text-xl font-bold leading-tight">{date.day}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="truncate text-[15px] font-semibold group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{event.name}</span>
          <EventStatusBadge status={event.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-muted">
          <span className="tabular">
            <span className="sr-only">Početak: </span>
            {date.weekday}, {formatTime(event.startsAt)}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{event.venueName}</span>
          </span>
          <span className="hidden text-ink-faint lg:inline">{event.organizerName}</span>
        </div>
      </div>

      <dl className="hidden shrink-0 grid-cols-3 gap-6 text-right sm:grid">
        {[
          ['Gosti', formatNumber(event.counts.guests)],
          ['Karte', formatNumber(event.counts.tickets)],
          ['Ušlo', `${formatNumber(event.counts.checkedIn)}${event.counts.tickets > 0 ? ` · ${rate}%` : ''}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">{label}</dt>
            <dd className="tabular mt-0.5 text-sm font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </Link>
  );
}

export function EventsPage() {
  const [view, setView] = React.useState<View>('active');
  const [search, setSearch] = React.useState('');
  const events = useEvents(view === 'archived');

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = events.data ?? [];
    return term ? list.filter((e) => `${e.name} ${e.venueName}`.toLowerCase().includes(term)) : list;
  }, [events.data, search]);

  const now = Date.now();
  const upcoming = filtered.filter((e) => new Date(e.endsAt ?? e.startsAt).getTime() >= now - 12 * 3_600_000).reverse();
  const past = filtered.filter((e) => !upcoming.includes(e));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Događaji"
        description="Svi tvoji događaji, liste gostiju i ulaznice na jednom mestu."
        actions={
          <Button asChild>
            <Link to="/events/new">
              <Plus /> Novi događaj
            </Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label="Prikaz"
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: 'Aktuelni' },
            { value: 'archived', label: 'Arhivirani' },
          ]}
        />
        <SearchInput value={search} onValueChange={setSearch} placeholder="Pretraži događaje" className="sm:w-72" />
      </div>

      {events.isPending ? (
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-5 border-b border-line px-5 py-4 last:border-b-0">
              <Skeleton className="h-14 w-14" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-56" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      ) : events.isError ? (
        <ErrorState error={events.error} onRetry={() => events.refetch()} />
      ) : filtered.length === 0 ? (
        search ? (
          <EmptyState icon={CalendarX2} title="Nema rezultata" description={`Nijedan događaj ne odgovara pretrazi „${search}".`} />
        ) : view === 'archived' ? (
          <EmptyState icon={CalendarX2} title="Arhiva je prazna" description="Arhivirani događaji će se pojaviti ovde. Arhiviranje ne briše goste ni karte." />
        ) : (
          <EmptyState
            icon={CalendarPlus}
            title="Još nema događaja"
            description="Kreiraj prvi događaj, dodaj goste i pošalji im pozivnice sa QR ulaznicama."
            action={
              <Button asChild>
                <Link to="/events/new">
                  <Plus /> Kreiraj događaj
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <section aria-labelledby="upcoming-heading">
              <h2 id="upcoming-heading" className="eyebrow mb-3">
                Predstojeći i u toku
              </h2>
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {upcoming.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}
          {past.length > 0 && (
            <section aria-labelledby="past-heading">
              <h2 id="past-heading" className="eyebrow mb-3">
                Prošli
              </h2>
              <div className="overflow-hidden rounded-lg border border-line bg-surface">
                {past.map((event) => (
                  <EventRow key={event.id} event={event} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
