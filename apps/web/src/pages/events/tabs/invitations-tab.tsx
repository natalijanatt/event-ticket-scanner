import { EMAIL_STATUS_LABELS, type DeliveryRowDto, type EmailStatus, type GuestEmailStatus, type Paginated } from '@event-platform/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Eye, MailX, RotateCw, Send } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { EmailStatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/input';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/ui/states';
import { Pagination, Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, qs } from '@/lib/api';
import { formatDateTime, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { EmailPreviewDialog, SendInvitationsDialog } from '../components/invitation-dialogs';
import { eventKeys, useEventContext, useEventStats } from '../event-queries';

const PAGE_SIZE = 50;

// What the organizer needs to tell apart: accepted by the provider ("Poslato")
// is NOT the same as confirmed by the recipient's server ("Isporuka potvrđena").
const SUMMARY: { key: GuestEmailStatus[]; label: string; hint: string; filter?: EmailStatus }[] = [
  { key: ['NOT_SENT'], label: 'Nije poslato', hint: 'gosti bez pozivnice' },
  { key: ['QUEUED', 'SENDING'], label: 'U redu za slanje', hint: 'slanje u toku', filter: 'QUEUED' },
  { key: ['SENT'], label: 'Poslato', hint: 'čeka se potvrda isporuke', filter: 'SENT' },
  { key: ['DELIVERED'], label: 'Isporuka potvrđena', hint: 'stiglo na server primaoca', filter: 'DELIVERED' },
  { key: ['BOUNCED', 'FAILED'], label: 'Greška pri slanju', hint: 'odbijeno ili neuspelo', filter: 'FAILED' },
];

export function EventInvitationsTab() {
  const { event } = useEventContext();
  const stats = useEventStats(event.id);
  const [search, setSearch] = React.useState('');
  const [status, setStatus] = React.useState<EmailStatus | undefined>();
  const [page, setPage] = React.useState(1);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [resendFor, setResendFor] = React.useState<string | null>(null);
  const debouncedSearch = useDebouncedValue(search);

  const filters = React.useMemo(() => ({ search: debouncedSearch.trim() || undefined, status }), [debouncedSearch, status]);
  React.useEffect(() => setPage(1), [filters]);

  const deliveries = useQuery({
    queryKey: eventKeys.invitations(event.id, { ...filters, page }),
    queryFn: () => api.get<Paginated<DeliveryRowDto>>(`/events/${event.id}/invitations${qs({ ...filters, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
    // Deliveries change on their own (queue, provider webhooks).
    refetchInterval: (query) => (query.state.data?.items.some((d) => d.status === 'QUEUED' || d.status === 'SENDING' || d.status === 'SENT') ? 4000 : false),
  });

  const total = deliveries.data?.total ?? 0;
  const rows = deliveries.data?.items ?? [];
  const inv = stats.data?.invitations;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-ink-muted">
          Istorija svih poslatih poruka. „Poslato” znači da je servis za slanje prihvatio poruku; „Isporuka potvrđena” da ju je primio server gosta.
        </p>
        <div className="flex shrink-0 gap-2">
          <Button variant="secondary" onClick={() => setPreviewOpen(true)}>
            <Eye /> Pregled pozivnice
          </Button>
          <Button asChild>
            <Link to="../guests" relative="path">
              <Send /> Pošalji pozivnice
            </Link>
          </Button>
        </div>
      </div>

      {/* Status per guest – doubles as the filter for the log below. */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3 lg:grid-cols-5">
        {SUMMARY.map((item) => {
          const value = inv ? item.key.reduce((sum, k) => sum + inv[k], 0) : null;
          const active = item.filter !== undefined && status === item.filter;
          const content = (
            <>
              <div className="text-[13px] font-medium text-ink-muted">{item.label}</div>
              <div className={cn('tabular mt-1 text-2xl font-bold leading-none', item.key.includes('FAILED') && value ? 'text-danger' : '')}>
                {value === null ? '–' : formatNumber(value)}
              </div>
              <div className="mt-1.5 text-xs text-ink-faint">{item.hint}</div>
            </>
          );
          return item.filter ? (
            <button
              key={item.label}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(active ? undefined : item.filter)}
              className={cn('bg-surface px-5 py-4 text-left transition-colors hover:bg-subtle/60', active && 'bg-accent-soft/60 hover:bg-accent-soft/60')}
            >
              {content}
            </button>
          ) : (
            <div key={item.label} className="bg-surface px-5 py-4">
              {content}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Gost ili email" className="w-full sm:w-72" />
        {status && (
          <Button variant="ghost" size="sm" onClick={() => setStatus(undefined)}>
            Filter: {EMAIL_STATUS_LABELS[status]} ✕
          </Button>
        )}
      </div>

      {deliveries.isPending ? (
        <TableSkeleton />
      ) : deliveries.isError ? (
        <ErrorState error={deliveries.error} onRetry={() => deliveries.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={MailX}
          title={status || filters.search ? 'Nema poruka za ovaj filter' : 'Još nijedna pozivnica nije poslata'}
          description={status || filters.search ? 'Promeni pretragu ili filter.' : 'Izaberi goste na listi i klikni „Pošalji pozivnice”. Svako slanje će biti zabeleženo ovde.'}
        />
      ) : (
        <>
          <TableFrame className={deliveries.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Primalac</Th>
                  <Th>Status</Th>
                  <Th className="hidden text-right md:table-cell">Karte</Th>
                  <Th className="hidden lg:table-cell">Poslato</Th>
                  <Th className="hidden lg:table-cell">Isporučeno</Th>
                  <Th className="w-12">
                    <span className="sr-only">Radnje</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => {
                  const failed = d.status === 'FAILED' || d.status === 'BOUNCED';
                  return (
                    <Tr key={d.id}>
                      <Td>
                        <div className="font-semibold">{d.guestName}</div>
                        <div className="text-[13px] text-ink-muted">{d.toEmail}</div>
                        {d.kind === 'RESEND' && <div className="mt-0.5 text-xs text-ink-faint">ponovno slanje</div>}
                      </Td>
                      <Td>
                        <EmailStatusBadge status={d.status} error={d.lastError} />
                        {d.lastError && <div className="mt-1 max-w-xs text-[13px] leading-snug text-danger">{d.lastError}</div>}
                        {d.attempts > 1 && <div className="mt-0.5 text-xs text-ink-faint">{d.attempts} pokušaja</div>}
                      </Td>
                      <Td className="tabular hidden text-right md:table-cell">{d.ticketCount}</Td>
                      <Td className="tabular hidden whitespace-nowrap text-ink-muted lg:table-cell">{d.sentAt ? formatDateTime(d.sentAt) : '—'}</Td>
                      <Td className="tabular hidden whitespace-nowrap text-ink-muted lg:table-cell">{d.deliveredAt ? formatDateTime(d.deliveredAt) : '—'}</Td>
                      <Td className="pl-0 text-right">
                        {(failed || d.status === 'SENT' || d.status === 'DELIVERED') && (
                          <Button variant="ghost" size="icon-sm" aria-label={`Pošalji ponovo: ${d.guestName}`} title="Pošalji ponovo" onClick={() => setResendFor(d.eventGuestId)}>
                            <RotateCw />
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </TableFrame>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}

      <EmailPreviewDialog eventId={event.id} open={previewOpen} onOpenChange={setPreviewOpen} />
      <SendInvitationsDialog eventId={event.id} eventGuestIds={resendFor ? [resendFor] : []} mode="RESEND" open={resendFor !== null} onOpenChange={(o) => !o && setResendFor(null)} />
    </div>
  );
}
