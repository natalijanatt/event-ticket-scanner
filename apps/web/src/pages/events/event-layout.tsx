import type { EventDto } from '@event-platform/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ArrowLeft, CalendarDays, Copy, Info, MapPin, MoreHorizontal, ScanLine } from 'lucide-react';
import * as React from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EventStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton, Spinner } from '@/components/ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api';
import { formatDateWithWeekday, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { eventKeys, useEvent, useEventStream } from './event-queries';

const TABS = [
  { to: '', label: 'Pregled', end: true },
  { to: 'guests', label: 'Gosti' },
  { to: 'tickets', label: 'Karte' },
  { to: 'invitations', label: 'Pozivnice' },
  { to: 'check-ins', label: 'Ulasci' },
  { to: 'analytics', label: 'Analitika' },
  { to: 'settings', label: 'Podešavanja' },
];

export function EventLayout() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const event = useEvent(eventId);
  useEventStream(eventId);

  const refreshLists = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) }), queryClient.invalidateQueries({ queryKey: ['events'] })]);

  const activate = useMutation({
    mutationFn: () => api.patch<EventDto>(`/events/${eventId}`, { status: 'ACTIVE' }),
    onSuccess: async () => {
      await refreshLists();
      toast.success('Događaj je aktiviran.', { description: 'Sada možeš da šalješ pozivnice i skeniraš karte.' });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const duplicate = useMutation({
    mutationFn: () => api.post<EventDto>(`/events/${eventId}/duplicate`),
    onSuccess: async (copy) => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Događaj je dupliran.', { description: 'Kopija je u nacrtu, bez gostiju i karata.' });
      navigate(`/events/${copy.id}/settings`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) => api.post<EventDto>(`/events/${eventId}/${archived ? 'archive' : 'unarchive'}`),
    onSuccess: async (_, archived) => {
      await refreshLists();
      toast.success(archived ? 'Događaj je arhiviran.' : 'Događaj je vraćen iz arhive.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (event.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-80" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (event.isError) {
    return (
      <div className="space-y-6">
        <Link to="/events" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> Događaji
        </Link>
        <ErrorState error={event.error} onRetry={() => event.refetch()} />
      </div>
    );
  }

  const data = event.data;
  const busy = duplicate.isPending || archive.isPending;

  return (
    <div className="space-y-6">
      <Link to="/events" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Događaji
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-[28px]">{data.name}</h1>
            <EventStatusBadge status={data.status} />
            {data.archivedAt && <span className="rounded-sm border border-line bg-subtle px-2 py-0.5 text-xs font-semibold text-ink-muted">Arhiviran</span>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden />
              {formatDateWithWeekday(data.startsAt)} u {formatTime(data.startsAt)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-4" aria-hidden />
              {data.venueName}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="secondary">
            <Link to={`/scanner?event=${data.id}`}>
              <ScanLine /> Skener
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="icon" aria-label="Još radnji" disabled={busy}>
                {busy ? <Spinner className="size-4" /> : <MoreHorizontal />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => duplicate.mutate()}>
                <Copy /> Dupliraj događaj
              </DropdownMenuItem>
              {data.archivedAt ? (
                <DropdownMenuItem onSelect={() => archive.mutate(false)}>
                  <ArchiveRestore /> Vrati iz arhive
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={() => archive.mutate(true)}>
                  <Archive /> Arhiviraj
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {data.status === 'DRAFT' && (
        <div className="flex flex-col gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2.5 text-sm text-ink">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <span>
              <strong className="font-semibold">Događaj je u nacrtu.</strong> Možeš da dodaješ goste i pripremaš karte, ali slanje pozivnica i skeniranje rade tek kada ga aktiviraš.
            </span>
          </p>
          <Button size="sm" className="shrink-0" loading={activate.isPending} onClick={() => activate.mutate()}>
            Aktiviraj događaj
          </Button>
        </div>
      )}
      {data.status === 'CANCELLED' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden />
          <span>
            <strong className="font-semibold">Događaj je otkazan.</strong> Karte više ne važe na ulazu, a gosti na svojoj ulaznici vide obaveštenje o otkazivanju.
          </span>
        </div>
      )}

      <nav aria-label="Sekcije događaja" className="-mx-4 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1">
          {TABS.map((tab) => (
            <li key={tab.to}>
              <NavLink
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cn(
                    '-mb-px inline-flex border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors',
                    isActive ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
                  )
                }
              >
                {tab.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <React.Suspense fallback={<Skeleton className="h-64 w-full" />}>
        <Outlet context={{ event: data }} />
      </React.Suspense>
    </div>
  );
}
