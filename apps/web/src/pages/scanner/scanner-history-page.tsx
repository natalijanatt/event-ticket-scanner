import { SCAN_METHOD_LABELS, SCAN_RESULT_LABELS, type ScanLogDto } from '@event-platform/shared';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, History, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Spinner } from '@/components/ui/controls';
import { api, errorMessage } from '@/lib/api';
import { formatDateShort, formatTimeSeconds } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The signed-in person's own recent scans (the API never returns anyone else's here). */
export function ScannerHistoryPage() {
  const history = useQuery({ queryKey: ['scanner', 'history'], queryFn: () => api.get<ScanLogDto[]>('/scanner/history'), staleTime: 0 });
  const admitted = history.data?.filter((l) => l.result === 'ADMITTED').length ?? 0;

  return (
    <div className="safe-top safe-bottom flex min-h-dvh flex-col bg-navy text-navy-text">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-navy-line bg-navy px-3 py-3">
        <Link to="/scanner" className="rounded-md p-2 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Nazad na skener">
          <ArrowLeft className="size-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-tight">Moja skeniranja</h1>
          {history.data && (
            <p className="text-xs text-navy-muted">
              Poslednjih {history.data.length} · {admitted} uspešnih
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => history.refetch()}
          className="rounded-md p-2 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy"
          aria-label="Osveži"
          disabled={history.isFetching}
        >
          <RefreshCw className={cn('size-5', history.isFetching && 'animate-spin')} />
        </button>
      </header>

      <main className="flex-1 px-4 py-4">
        {history.isPending ? (
          <div className="flex justify-center py-16">
            <Spinner className="size-6 text-navy-muted" />
          </div>
        ) : history.isError ? (
          <div role="alert" className="rounded-lg border border-navy-line bg-navy-raised p-5 text-center">
            <p className="font-semibold">Istorija nije učitana</p>
            <p className="mt-1 text-sm text-navy-muted">{errorMessage(history.error)}</p>
            <button type="button" onClick={() => history.refetch()} className="mt-4 h-11 rounded-md bg-navy-text px-5 text-sm font-bold text-navy">
              Pokušaj ponovo
            </button>
          </div>
        ) : history.data.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <History className="mx-auto size-10 text-navy-muted" strokeWidth={1.25} aria-hidden />
            <p className="mt-4 font-semibold">Još nema skeniranja</p>
            <p className="mt-1 text-sm text-navy-muted">Karte koje skeniraš pojaviće se ovde.</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {history.data.map((log) => {
              const ok = log.result === 'ADMITTED';
              return (
                <li key={log.id} className="flex items-center gap-3 rounded-lg border border-navy-line bg-navy-raised px-4 py-3">
                  <span aria-hidden className={cn('h-10 w-1 shrink-0 rounded-full', ok ? 'bg-[#34D399]' : 'bg-[#F87171]')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-bold">{log.guestName ?? 'Nepoznata karta'}</div>
                    <div className="truncate text-xs text-navy-muted">
                      {log.ticketType ? `${log.ticketType.name} · ` : ''}
                      {log.eventName}
                      {log.method === 'MANUAL' ? ` · ${SCAN_METHOD_LABELS.MANUAL.toLowerCase()}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={cn('text-xs font-bold uppercase', ok ? 'text-[#6EE7B7]' : 'text-[#FCA5A5]')}>{SCAN_RESULT_LABELS[log.result]}</div>
                    <div className="tabular text-xs text-navy-muted">
                      {formatDateShort(log.createdAt)} {formatTimeSeconds(log.createdAt)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
