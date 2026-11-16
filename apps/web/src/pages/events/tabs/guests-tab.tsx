import {
  EMAIL_STATUS_LABELS,
  GUEST_TICKET_STATE_LABELS,
  type GenerateTicketsResult,
  type GuestExportFormat,
  type GuestEmailStatus,
  type GuestRowDto,
  type GuestTicketState,
  type Paginated,
  type RevokeTicketsResult,
} from '@event-platform/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  ChevronDown,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  FileUp,
  ListPlus,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Send,
  Ticket,
  Trash2,
  UserPlus,
  UserSearch,
  Users,
  X,
} from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmailStatusBadge, GuestTicketBadge, TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { ConfirmDialog } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Pagination, Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, errorMessage, qs } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDateTime, formatNumber, plural } from '@/lib/format';
import { BulkAddDialog, GuestFormDialog, ImportDialog } from '../components/guest-dialogs';
import { EmailPreviewDialog, SendInvitationsDialog } from '../components/invitation-dialogs';
import { eventKeys, useEventContext, useTicketTypes } from '../event-queries';

const PAGE_SIZE = 50;
const ALL = 'ALL';

const EMAIL_FILTERS: GuestEmailStatus[] = ['NOT_SENT', 'QUEUED', 'SENT', 'DELIVERED', 'FAILED'];
const TICKET_FILTERS: GuestTicketState[] = ['NONE', 'VALID', 'PARTIALLY_USED', 'USED', 'REVOKED'];

type Confirm = { kind: 'revoke' | 'remove'; ids: string[]; label: string } | null;
type SendTarget = { ids: string[]; mode: 'SEND' | 'RESEND' } | null;

export function EventGuestsTab() {
  const { event } = useEventContext();
  const queryClient = useQueryClient();
  const ticketTypes = useTicketTypes(event.id);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [search, setSearch] = React.useState('');
  const [ticketTypeId, setTicketTypeId] = React.useState(ALL);
  const [emailStatus, setEmailStatus] = React.useState<string>(ALL);
  const [ticketState, setTicketState] = React.useState<string>(ALL);
  const [page, setPage] = React.useState(1);
  const debouncedSearch = useDebouncedValue(search);

  const filters = React.useMemo(
    () => ({
      search: debouncedSearch.trim() || undefined,
      ticketTypeId: ticketTypeId === ALL ? undefined : ticketTypeId,
      emailStatus: emailStatus === ALL ? undefined : emailStatus,
      ticketState: ticketState === ALL ? undefined : ticketState,
    }),
    [debouncedSearch, ticketTypeId, emailStatus, ticketState],
  );
  const hasFilters = Object.values(filters).some(Boolean);
  React.useEffect(() => setPage(1), [filters]);

  const guests = useQuery({
    queryKey: eventKeys.guests(event.id, { ...filters, page }),
    queryFn: () => api.get<Paginated<GuestRowDto>>(`/events/${event.id}/guests${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  // ── Selection (survives paging; cleared when filters change) ──────────────
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  React.useEffect(() => setSelected(new Set()), [filters]);

  const rows = guests.data?.items ?? [];
  const total = guests.data?.total ?? 0;
  const pageIds = rows.map((r) => r.id);
  const pageSelected = pageIds.filter((id) => selected.has(id)).length;
  const allPageSelected = pageIds.length > 0 && pageSelected === pageIds.length;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const togglePage = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of pageIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const selectAllMatching = useMutation({
    mutationFn: () => api.get<{ ids: string[] }>(`/events/${event.id}/guests/ids${qs(filters)}`),
    onSuccess: (result) => setSelected(new Set(result.ids)),
    onError: (err) => toast.error(errorMessage(err)),
  });

  // ── Dialog state ──────────────────────────────────────────────────────────
  const [addOpen, setAddOpen] = React.useState(false);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<GuestRowDto | null>(null);
  const [previewFor, setPreviewFor] = React.useState<string | null>(null);
  const [sendTarget, setSendTarget] = React.useState<SendTarget>(null);
  const [confirm, setConfirm] = React.useState<Confirm>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const generate = useMutation({
    mutationFn: (ids: string[]) => api.post<GenerateTicketsResult>(`/events/${event.id}/tickets/generate`, { eventGuestIds: ids }),
    onSuccess: async (result) => {
      await refresh();
      if (result.generated === 0 && result.skippedForCapacity === 0) {
        toast.info('Svi izabrani gosti već imaju svoje karte.');
        return;
      }
      toast.success(`Generisano: ${formatNumber(result.generated)} ${plural(result.generated, 'karta', 'karte', 'karata')}`, {
        description:
          result.skippedForCapacity > 0
            ? `${formatNumber(result.skippedForCapacity)} nije generisano — popunjen je kapacitet tipa karte.`
            : `Za ${formatNumber(result.guestsAffected)} ${plural(result.guestsAffected, 'gosta', 'gosta', 'gostiju')}. Pozivnice još nisu poslate.`,
      });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const revoke = useMutation({
    mutationFn: (ids: string[]) => api.post<RevokeTicketsResult>(`/events/${event.id}/tickets/revoke`, { eventGuestIds: ids }),
    onSuccess: async (result) => {
      await refresh();
      setConfirm(null);
      if (result.revoked === 0) toast.info('Nema važećih karata za poništavanje.');
      else toast.success(`Poništeno: ${formatNumber(result.revoked)} ${plural(result.revoked, 'karta', 'karte', 'karata')}`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (ids: string[]) => api.post<{ removed: number; skippedCheckedIn: number }>(`/events/${event.id}/guests/remove`, { eventGuestIds: ids }),
    onSuccess: async (result, ids) => {
      await refresh();
      setConfirm(null);
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      toast.success(`Uklonjeno: ${formatNumber(result.removed)} ${plural(result.removed, 'gost', 'gosta', 'gostiju')}`, {
        description: result.skippedCheckedIn > 0 ? `${formatNumber(result.skippedCheckedIn)} nije uklonjeno jer su već ušli na događaj.` : undefined,
      });
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  // Without an explicit selection the export follows the active filters.
  const exportGuests = useMutation({
    mutationFn: async ({ format, ids }: { format: GuestExportFormat; ids?: string[] }) => {
      const res = await api.post<Response>(`/events/${event.id}/guests/export`, ids ? { format, eventGuestIds: ids } : { format, filters }, { raw: true });
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `gosti.${format}`;
      downloadFile(await res.blob(), name);
    },
    onSuccess: () => toast.success('Lista gostiju je preuzeta.'),
    onError: (err) => toast.error(errorMessage(err)),
  });

  const selectedIds = [...selected];
  const types = ticketTypes.data ?? [];
  const noTypes = ticketTypes.isSuccess && types.length === 0;

  // ── Render ────────────────────────────────────────────────────────────────
  const addMenu = (
    <div className="flex">
      <Button onClick={() => setAddOpen(true)} disabled={noTypes} className="rounded-r-none">
        <UserPlus /> Dodaj gosta
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="rounded-l-none border-l border-navy-line px-2.5" aria-label="Još načina dodavanja" disabled={noTypes}>
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => setBulkOpen(true)}>
            <ListPlus /> Dodaj više gostiju
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setImportOpen(true)}>
            <FileUp /> Uvezi iz CSV / Excel fajla
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Ime ili email" className="sm:w-64" />
          <Select value={ticketTypeId} onValueChange={setTicketTypeId}>
            <SelectTrigger className="sm:w-40" aria-label="Filter: tip karte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Svi tipovi</SelectItem>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={emailStatus} onValueChange={setEmailStatus}>
            <SelectTrigger className="sm:w-48" aria-label="Filter: status pozivnice">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Sve pozivnice</SelectItem>
              {EMAIL_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {EMAIL_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={ticketState} onValueChange={setTicketState}>
            <SelectTrigger className="sm:w-48" aria-label="Filter: status karte">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Sve karte</SelectItem>
              {TICKET_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {GUEST_TICKET_STATE_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" loading={exportGuests.isPending} disabled={total === 0}>
                <Download /> Izvezi <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>{hasFilters ? `Filtrirani gosti (${formatNumber(total)})` : `Svi gosti (${formatNumber(total)})`}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => exportGuests.mutate({ format: 'xlsx' })}>
                <FileSpreadsheet /> Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => exportGuests.mutate({ format: 'csv' })}>
                <FileText /> CSV (.csv)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {addMenu}
        </div>
      </div>

      {noTypes && (
        <p role="status" className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm">
          Događaj nema nijedan tip karte.{' '}
          <Link to="../settings" relative="path" className="font-semibold underline underline-offset-2">
            Dodaj tip karte
          </Link>{' '}
          da bi mogao/la da dodaješ goste.
        </p>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div role="region" aria-label="Radnje nad izabranim gostima" className="sticky top-16 z-20 flex flex-col gap-3 rounded-lg border border-navy bg-navy px-4 py-3 text-navy-text sm:flex-row sm:items-center sm:justify-between lg:top-3">
          <div className="flex items-center gap-3 text-sm">
            <button type="button" onClick={() => setSelected(new Set())} className="rounded p-1 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Poništi izbor">
              <X className="size-4" />
            </button>
            <span className="font-semibold">
              Izabrano: {formatNumber(selected.size)} {plural(selected.size, 'gost', 'gosta', 'gostiju')}
            </span>
            {allPageSelected && selected.size < total && (
              <button
                type="button"
                onClick={() => selectAllMatching.mutate()}
                disabled={selectAllMatching.isPending}
                className="font-semibold text-accent underline underline-offset-2 focus-visible:ring-offset-navy"
              >
                Izaberi svih {formatNumber(total)}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" className="bg-accent text-navy hover:bg-accent/90" onClick={() => setSendTarget({ ids: selectedIds, mode: 'SEND' })}>
              <Send /> Pošalji pozivnice
            </Button>
            <Button size="sm" variant="secondary" className="border-navy-line bg-navy-raised text-navy-text hover:bg-navy-line" loading={generate.isPending} onClick={() => generate.mutate(selectedIds)}>
              <Ticket /> Generiši karte
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="secondary" className="border-navy-line bg-navy-raised text-navy-text hover:bg-navy-line">
                  Još <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onSelect={() => setSendTarget({ ids: selectedIds, mode: 'RESEND' })}>
                  <RotateCw /> Pošalji pozivnice ponovo
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportGuests.mutate({ format: 'xlsx', ids: selectedIds })}>
                  <FileSpreadsheet /> Izvezi izabrane u Excel
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => exportGuests.mutate({ format: 'csv', ids: selectedIds })}>
                  <FileText /> Izvezi izabrane u CSV
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  destructive
                  onSelect={() => setConfirm({ kind: 'revoke', ids: selectedIds, label: `${formatNumber(selected.size)} ${plural(selected.size, 'gosta', 'gosta', 'gostiju')}` })}
                >
                  <Ban /> Poništi izabrane karte
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  onSelect={() => setConfirm({ kind: 'remove', ids: selectedIds, label: `${formatNumber(selected.size)} ${plural(selected.size, 'gosta', 'gosta', 'gostiju')}` })}
                >
                  <Trash2 /> Ukloni sa liste
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {guests.isPending ? (
        <TableSkeleton rows={8} />
      ) : guests.isError ? (
        <ErrorState error={guests.error} onRetry={() => guests.refetch()} />
      ) : total === 0 ? (
        hasFilters ? (
          <EmptyState
            icon={UserSearch}
            title="Nema gostiju za ovaj filter"
            description="Promeni pretragu ili filtere da vidiš ostale goste."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setSearch('');
                  setTicketTypeId(ALL);
                  setEmailStatus(ALL);
                  setTicketState(ALL);
                }}
              >
                Poništi filtere
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Users}
            title="Lista gostiju je prazna"
            description="Dodaj prvog gosta ručno ili uvezi celu listu iz CSV ili Excel fajla. Karte i pozivnice praviš kada budeš spreman/na."
            action={
              <>
                <Button onClick={() => setAddOpen(true)} disabled={noTypes}>
                  <UserPlus /> Dodaj gosta
                </Button>
                <Button variant="secondary" onClick={() => setImportOpen(true)} disabled={noTypes}>
                  <FileUp /> Uvezi iz fajla
                </Button>
              </>
            }
          />
        )
      ) : (
        <>
          <TableFrame className={guests.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th className="w-10 pr-0">
                    <Checkbox
                      checked={allPageSelected ? true : pageSelected > 0 ? 'indeterminate' : false}
                      onCheckedChange={(v) => togglePage(v === true)}
                      aria-label="Izaberi sve goste na ovoj strani"
                    />
                  </Th>
                  <Th>Gost</Th>
                  <Th className="hidden md:table-cell">Tip karte</Th>
                  <Th className="text-right">Karte</Th>
                  <Th>Pozivnica</Th>
                  <Th className="hidden sm:table-cell">Karta</Th>
                  <Th className="hidden lg:table-cell">Ulazak</Th>
                  <Th className="w-12">
                    <span className="sr-only">Radnje</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((guest) => {
                  const issued = guest.tickets.valid + guest.tickets.used;
                  const name = `${guest.firstName} ${guest.lastName}`.trim();
                  const invited = guest.emailStatus !== 'NOT_SENT';
                  return (
                    <Tr key={guest.id} selected={selected.has(guest.id)}>
                      <Td className="pr-0">
                        <Checkbox checked={selected.has(guest.id)} onCheckedChange={(v) => toggle(guest.id, v === true)} aria-label={`Izaberi: ${name}`} />
                      </Td>
                      <Td>
                        <div className="font-semibold">{name}</div>
                        <div className="text-[13px] text-ink-muted">{guest.email}</div>
                        <div className="mt-1 md:hidden">
                          <TicketTypeTag name={guest.ticketType.name} color={guest.ticketType.color} className="text-[13px]" />
                        </div>
                      </Td>
                      <Td className="hidden md:table-cell">
                        <TicketTypeTag name={guest.ticketType.name} color={guest.ticketType.color} />
                      </Td>
                      <Td className="text-right">
                        <span className="tabular font-semibold">{guest.ticketQuantity}</span>
                        {issued < guest.ticketQuantity && (
                          <div className="tabular whitespace-nowrap text-xs text-ink-faint" title="Izdato karata od dodeljenog broja">
                            izdato {issued}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <EmailStatusBadge status={guest.emailStatus} error={guest.emailError} />
                      </Td>
                      <Td className="hidden sm:table-cell">
                        <GuestTicketBadge state={guest.ticketState} />
                      </Td>
                      <Td className="hidden whitespace-nowrap lg:table-cell">
                        {guest.tickets.used > 0 ? (
                          <>
                            <span className="tabular font-medium">
                              {guest.tickets.used}/{issued}
                            </span>
                            <span className="ml-2 text-[13px] text-ink-muted">{formatDateTime(guest.firstCheckInAt)}</span>
                          </>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </Td>
                      <Td className="pl-0 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" aria-label={`Radnje: ${name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent>
                            <DropdownMenuItem onSelect={() => setSendTarget({ ids: [guest.id], mode: invited ? 'RESEND' : 'SEND' })}>
                              {invited ? <RotateCw /> : <Send />}
                              {invited ? 'Pošalji pozivnicu ponovo' : 'Pošalji pozivnicu'}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setPreviewFor(guest.id)}>
                              <Eye /> Pregled pozivnice
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={issued >= guest.ticketQuantity} onSelect={() => generate.mutate([guest.id])}>
                              <Ticket /> Generiši karte
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing(guest)}>
                              <Pencil /> Izmeni
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem destructive disabled={guest.tickets.valid === 0} onSelect={() => setConfirm({ kind: 'revoke', ids: [guest.id], label: name })}>
                              <Ban /> Poništi karte
                            </DropdownMenuItem>
                            <DropdownMenuItem destructive disabled={guest.tickets.used > 0} onSelect={() => setConfirm({ kind: 'remove', ids: [guest.id], label: name })}>
                              <Trash2 /> Ukloni sa liste
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableFrame>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
          {total <= PAGE_SIZE && (
            <p className="tabular text-sm text-ink-muted">
              {formatNumber(total)} {plural(total, 'gost', 'gosta', 'gostiju')}
            </p>
          )}
        </>
      )}

      {/* Dialogs */}
      <GuestFormDialog event={event} ticketTypes={types} open={addOpen} onOpenChange={setAddOpen} />
      <GuestFormDialog event={event} ticketTypes={types} guest={editing ?? undefined} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      <BulkAddDialog event={event} ticketTypes={types} open={bulkOpen} onOpenChange={setBulkOpen} />
      <ImportDialog event={event} ticketTypes={types} open={importOpen} onOpenChange={setImportOpen} />
      <EmailPreviewDialog eventId={event.id} eventGuestId={previewFor ?? undefined} open={previewFor !== null} onOpenChange={(o) => !o && setPreviewFor(null)} />
      <SendInvitationsDialog
        eventId={event.id}
        eventGuestIds={sendTarget?.ids ?? []}
        mode={sendTarget?.mode ?? 'SEND'}
        open={sendTarget !== null}
        onOpenChange={(o) => !o && setSendTarget(null)}
        onSent={() => setSelected(new Set())}
      />
      <ConfirmDialog
        open={confirm?.kind === 'revoke'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Poništavanje karata"
        description={
          <>
            Sve važeće karte za <strong className="text-ink">{confirm?.label}</strong> prestaju da važe odmah — QR kod će na ulazu biti odbijen. Već iskorišćene karte se ne menjaju. Ova radnja se ne može opozvati.
          </>
        }
        confirmLabel="Poništi karte"
        loading={revoke.isPending}
        onConfirm={() => confirm && revoke.mutate(confirm.ids)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Uklanjanje sa liste"
        description={
          <>
            <strong className="text-ink">{confirm?.label}</strong> — uklanjanjem sa liste brišu se i neiskorišćene karte i istorija pozivnica za ovaj događaj. Gosti koji su već ušli ostaju na listi.
          </>
        }
        confirmLabel="Ukloni"
        loading={remove.isPending}
        onConfirm={() => confirm && remove.mutate(confirm.ids)}
      />
    </div>
  );
}
