import { TICKET_STATUS_LABELS, TICKET_STATUSES, type Paginated, type TicketLinkDto, type TicketRowDto } from '@event-platform/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CalendarClock, ExternalLink, Link2, MoreHorizontal, QrCode, Search, Ticket } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { TicketStatusBadge, TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, SearchInput } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Pagination, Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, errorMessage, qs } from '@/lib/api';
import { formatDateTime, fromDateTimeInputs, toDateInput, toTimeInput } from '@/lib/format';
import { eventKeys, useEventContext, useTicketTypes } from '../event-queries';

const PAGE_SIZE = 50;
const ALL = 'ALL';

type Confirm = { kind: 'revoke' | 'regenerate'; ticket: TicketRowDto } | null;

async function copyLink(url: string, message: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success(message, { description: 'Ko ima link, može da iskoristi kartu — deli ga samo sa gostom.' });
  } catch {
    // Clipboard blocked (insecure origin / permissions): show it for manual copy.
    toast.message('Link ka karti', { description: url, duration: 15_000 });
  }
}

function ExpiryDialog({ eventId, ticket, onClose }: { eventId: string; ticket: TicketRowDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [date, setDate] = React.useState('');
  const [time, setTime] = React.useState('');

  React.useEffect(() => {
    setDate(toDateInput(ticket?.expiresAt));
    setTime(toTimeInput(ticket?.expiresAt));
  }, [ticket]);

  const save = useMutation({
    mutationFn: (expiresAt: string | null) => api.patch(`/events/${eventId}/tickets/${ticket?.id}`, { expiresAt }),
    onSuccess: async (_, expiresAt) => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) });
      toast.success(expiresAt ? 'Rok važenja je sačuvan.' : 'Rok važenja je uklonjen.');
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const iso = fromDateTimeInputs(date, time);
  return (
    <Dialog open={ticket !== null} onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title="Rok važenja karte" description={`Karta ${ticket?.reference ?? ''} — posle ovog trenutka skener je odbija kao isteklu.`} />
        <DialogBody className="grid gap-5 sm:grid-cols-2">
          <Field label="Datum" htmlFor="expiry-date">
            <Input id="expiry-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Vreme" htmlFor="expiry-time">
            <Input id="expiry-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          {ticket?.expiresAt && (
            <Button variant="danger-outline" className="sm:mr-auto" onClick={() => save.mutate(null)} disabled={save.isPending}>
              Ukloni rok
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>
            Odustani
          </Button>
          <Button onClick={() => save.mutate(iso)} loading={save.isPending} disabled={!iso}>
            Sačuvaj
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EventTicketsTab() {
  const { event } = useEventContext();
  const queryClient = useQueryClient();
  const ticketTypes = useTicketTypes(event.id);

  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState(ALL);
  const [ticketTypeId, setTicketTypeId] = React.useState(ALL);
  const [page, setPage] = React.useState(1);
  const [confirm, setConfirm] = React.useState<Confirm>(null);
  const [expiryFor, setExpiryFor] = React.useState<TicketRowDto | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const filters = React.useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      status: status === ALL ? undefined : status,
      ticketTypeId: ticketTypeId === ALL ? undefined : ticketTypeId,
    }),
    [debouncedSearch, status, ticketTypeId],
  );
  const hasFilters = Object.values(filters).some(Boolean);
  React.useEffect(() => setPage(1), [filters]);

  const tickets = useQuery({
    queryKey: eventKeys.tickets(event.id, { ...filters, page }),
    queryFn: () => api.get<Paginated<TicketRowDto>>(`/events/${event.id}/tickets${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });

  const reveal = useMutation({
    mutationFn: (ticket: TicketRowDto) => api.get<TicketLinkDto>(`/events/${event.id}/tickets/${ticket.id}/link`),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (ticket: TicketRowDto) => api.post(`/events/${event.id}/tickets/revoke`, { ticketIds: [ticket.id] }),
    onSuccess: async () => {
      await refresh();
      setConfirm(null);
      toast.success('Karta je poništena.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const regenerate = useMutation({
    mutationFn: (ticket: TicketRowDto) => api.post<TicketLinkDto>(`/events/${event.id}/tickets/${ticket.id}/regenerate`),
    onSuccess: async (result) => {
      await refresh();
      setConfirm(null);
      await copyLink(result.url, 'Novi QR kod je napravljen, a link je kopiran.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const total = tickets.data?.total ?? 0;
  const rows = tickets.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Gost, email ili broj karte" className="sm:w-72" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44" aria-label="Filter: status karte">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Svi statusi</SelectItem>
            {TICKET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={ticketTypeId} onValueChange={setTicketTypeId}>
          <SelectTrigger className="sm:w-40" aria-label="Filter: tip karte">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Svi tipovi</SelectItem>
            {(ticketTypes.data ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {tickets.isPending ? (
        <TableSkeleton rows={8} />
      ) : tickets.isError ? (
        <ErrorState error={tickets.error} onRetry={() => tickets.refetch()} />
      ) : total === 0 ? (
        hasFilters ? (
          <EmptyState icon={Search} title="Nema karata za ovaj filter" description="Promeni pretragu ili filtere." />
        ) : (
          <EmptyState
            icon={Ticket}
            title="Još nema generisanih karata"
            description="Karte nastaju kada gostu pošalješ pozivnicu ili u listi gostiju izabereš „Generiši karte”. Svaka karta ima sopstveni QR kod."
            action={
              <Button asChild>
                <Link to="../guests" relative="path">
                  Idi na goste
                </Link>
              </Button>
            }
          />
        )
      ) : (
        <>
          <TableFrame className={tickets.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Broj karte</Th>
                  <Th>Gost</Th>
                  <Th className="hidden md:table-cell">Tip</Th>
                  <Th>Status</Th>
                  <Th className="hidden lg:table-cell">Ulazak</Th>
                  <Th className="hidden xl:table-cell">Kreirana</Th>
                  <Th className="w-12">
                    <span className="sr-only">Radnje</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ticket) => (
                  <Tr key={ticket.id}>
                    <Td className="whitespace-nowrap font-mono text-[13px] font-medium">{ticket.reference}</Td>
                    <Td>
                      <div className="font-semibold">{ticket.guestName}</div>
                      <div className="text-[13px] text-ink-muted">{ticket.guestEmail}</div>
                    </Td>
                    <Td className="hidden md:table-cell">
                      <TicketTypeTag name={ticket.ticketType.name} color={ticket.ticketType.color} />
                    </Td>
                    <Td>
                      <TicketStatusBadge status={ticket.status} />
                      {ticket.expiresAt && ticket.status === 'VALID' && (
                        <div className="mt-1 whitespace-nowrap text-xs text-ink-muted">važi do {formatDateTime(ticket.expiresAt)}</div>
                      )}
                    </Td>
                    <Td className="hidden whitespace-nowrap lg:table-cell">
                      {ticket.usedAt ? (
                        <>
                          <div className="tabular">{formatDateTime(ticket.usedAt)}</div>
                          {ticket.scannedByName && <div className="text-[13px] text-ink-muted">skenirao/la {ticket.scannedByName}</div>}
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td className="tabular hidden whitespace-nowrap text-ink-muted xl:table-cell">{formatDateTime(ticket.createdAt)}</Td>
                    <Td className="pl-0 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Radnje: karta ${ticket.reference}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem
                            disabled={ticket.status === 'REVOKED'}
                            onSelect={() => reveal.mutate(ticket, { onSuccess: (r) => void copyLink(r.url, 'Link ka karti je kopiran.') })}
                          >
                            <Link2 /> Kopiraj link ka karti
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={ticket.status === 'REVOKED'}
                            onSelect={() => reveal.mutate(ticket, { onSuccess: (r) => window.open(r.url, '_blank', 'noopener,noreferrer') })}
                          >
                            <ExternalLink /> Otvori kartu
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={ticket.status !== 'VALID'} onSelect={() => setExpiryFor(ticket)}>
                            <CalendarClock /> Rok važenja
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={ticket.status !== 'VALID'} onSelect={() => setConfirm({ kind: 'regenerate', ticket })}>
                            <QrCode /> Napravi novi QR kod
                          </DropdownMenuItem>
                          <DropdownMenuItem destructive disabled={ticket.status !== 'VALID'} onSelect={() => setConfirm({ kind: 'revoke', ticket })}>
                            <Ban /> Poništi kartu
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}

      <ExpiryDialog eventId={event.id} ticket={expiryFor} onClose={() => setExpiryFor(null)} />
      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Poništavanje karte"
        description={
          <>
            Karta <strong className="font-mono text-ink">{confirm?.ticket.reference}</strong> ({confirm?.ticket.guestName}) prestaje da važi odmah i biće odbijena na ulazu. Ova radnja se ne može opozvati.
          </>
        }
        confirmLabel="Poništi kartu"
        loading={revoke.isPending}
        onConfirm={() => confirm && revoke.mutate(confirm.ticket)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'regenerate'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Novi QR kod"
        description={
          <>
            Stari QR kod i link za kartu <strong className="font-mono text-ink">{confirm?.ticket.reference}</strong> prestaju da rade odmah. Korisno kada je gost prosledio kartu pogrešnoj osobi. Posle ovoga gostu pošalji pozivnicu ponovo.
          </>
        }
        confirmLabel="Napravi novi kod"
        variant="primary"
        loading={regenerate.isPending}
        onConfirm={() => confirm && regenerate.mutate(confirm.ticket)}
      />
    </div>
  );
}
