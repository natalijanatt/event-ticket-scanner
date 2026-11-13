import { SCAN_METHOD_LABELS, SCAN_RESULT_LABELS, SCAN_RESULTS, type Paginated, type ScanLogDto } from '@event-platform/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ScanLine } from 'lucide-react';
import * as React from 'react';
import { Link } from 'react-router-dom';
import { ScanResultBadge, TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, Stat, StatGrid, TableSkeleton } from '@/components/ui/states';
import { Pagination, Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { api, qs } from '@/lib/api';
import { formatDateShort, formatNumber, formatPercent, formatTimeSeconds } from '@/lib/format';
import { eventKeys, useEventContext, useEventStats } from '../event-queries';

const PAGE_SIZE = 50;
const ALL = 'ALL';

export function EventCheckInsTab() {
  const { event } = useEventContext();
  const stats = useEventStats(event.id);
  const [result, setResult] = React.useState(ALL);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => setPage(1), [result]);

  const logs = useQuery({
    queryKey: eventKeys.checkIns(event.id, { result, page }),
    queryFn: () => api.get<Paginated<ScanLogDto>>(`/events/${event.id}/check-ins${qs({ result: result === ALL ? undefined : result, page, pageSize: PAGE_SIZE })}`),
    placeholderData: keepPreviousData,
  });

  const s = stats.data;
  const rejected = s ? Object.entries(s.scanResults).reduce((sum, [key, n]) => (key === 'ADMITTED' ? sum : sum + (n ?? 0)), 0) : 0;
  const total = logs.data?.total ?? 0;
  const rows = logs.data?.items ?? [];

  return (
    <div className="space-y-5">
      {s && (
        <StatGrid className="lg:grid-cols-4">
          <Stat label="Ušlo" value={formatNumber(s.tickets.used)} tone="success" hint={`${formatPercent(s.checkInRate)} izdatih karata`} />
          <Stat label="Još se očekuje" value={formatNumber(s.tickets.valid)} hint="važeće, neiskorišćene karte" />
          <Stat label="Gostiju unutra" value={formatNumber(s.guests.checkedIn)} hint={`od ${formatNumber(s.guests.total)} pozvanih`} />
          <Stat label="Odbijena skeniranja" value={formatNumber(rejected)} tone={rejected > 0 ? 'danger' : 'default'} hint="duple, poništene i nevažeće karte" />
        </StatGrid>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select value={result} onValueChange={setResult}>
          <SelectTrigger className="sm:w-56" aria-label="Filter: rezultat skeniranja">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Sva skeniranja</SelectItem>
            {SCAN_RESULTS.map((r) => (
              <SelectItem key={r} value={r}>
                {SCAN_RESULT_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[13px] text-ink-muted">Zapisuje se svaki pokušaj skeniranja — i uspešan i odbijen. Lista se osvežava uživo.</p>
      </div>

      {logs.isPending ? (
        <TableSkeleton />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => logs.refetch()} />
      ) : total === 0 ? (
        <EmptyState
          icon={ScanLine}
          title={result === ALL ? 'Još nema skeniranja' : 'Nema skeniranja sa ovim rezultatom'}
          description={result === ALL ? 'Kada osoblje počne da skenira karte na ulazu, svaki pokušaj će se pojaviti ovde.' : 'Izaberi drugi rezultat ili prikaži sva skeniranja.'}
          action={
            result === ALL ? (
              <Button asChild variant="secondary">
                <Link to={`/scanner?event=${event.id}`}>
                  <ScanLine /> Otvori skener
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <TableFrame className={logs.isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <thead>
                <tr>
                  <Th>Vreme</Th>
                  <Th>Rezultat</Th>
                  <Th>Gost</Th>
                  <Th className="hidden md:table-cell">Karta</Th>
                  <Th className="hidden lg:table-cell">Skenirao/la</Th>
                  <Th className="hidden lg:table-cell">Način</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <Tr key={log.id}>
                    <Td className="whitespace-nowrap">
                      <div className="tabular font-medium">{formatTimeSeconds(log.createdAt)}</div>
                      <div className="text-xs text-ink-faint">{formatDateShort(log.createdAt)}</div>
                    </Td>
                    <Td>
                      <ScanResultBadge result={log.result} />
                    </Td>
                    <Td className="font-semibold">{log.guestName ?? <span className="font-normal text-ink-faint">Nepoznata karta</span>}</Td>
                    <Td className="hidden md:table-cell">
                      {log.reference ? (
                        <>
                          <div className="font-mono text-[13px]">{log.reference}</div>
                          {log.ticketType && <TicketTypeTag name={log.ticketType.name} color={log.ticketType.color} className="text-[13px] text-ink-muted" />}
                        </>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td className="hidden text-ink-muted lg:table-cell">{log.scannerName}</Td>
                    <Td className="hidden text-ink-muted lg:table-cell">{SCAN_METHOD_LABELS[log.method]}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </TableFrame>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
