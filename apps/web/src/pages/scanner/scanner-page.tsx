import { extractTicketToken, TICKET_STATUS_LABELS, type CheckInResponse, type ScannerEventDto, type ScannerSearchResultDto } from '@event-platform/shared';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Camera, CameraOff, ChevronDown, Flashlight, FlashlightOff, History, LogOut, Search, SwitchCamera, Wifi, WifiOff, X } from 'lucide-react';
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, useUser } from '@/auth/auth-context';
import { Spinner } from '@/components/ui/controls';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { api, ApiError, errorMessage, NetworkError } from '@/lib/api';
import { formatDateShort, formatNumber, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { signalRejected, signalSuccess, unlockAudio } from './feedback';
import { ScanResultView, type ScanOutcome } from './scan-result';
import { cameraAlreadyGranted, useQrScanner } from './use-qr-scanner';

const EVENT_KEY = 'scanner.eventId';
const COUNT_KEY = (eventId: string) => `scanner.count.${eventId}`;
/** The server must answer within this time, otherwise the scan counts as "not verified". */
const CHECK_IN_TIMEOUT_MS = 8000;

// sessionStorage keeps the chosen event and the session counter across an
// accidental refresh. Only ids and a number are stored – never guest data.
function session(key: string, value?: string | null): string | null {
  try {
    if (value === undefined) return sessionStorage.getItem(key);
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) */
  }
  return value ?? null;
}

function useOnline(): boolean {
  const [online, setOnline] = React.useState(() => navigator.onLine);
  React.useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

type CheckInBody = { token: string } | { ticketId: string };

export function ScannerPage() {
  const user = useUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const online = useOnline();

  const events = useQuery({ queryKey: ['scanner', 'events'], queryFn: () => api.get<ScannerEventDto[]>('/scanner/events') });

  // ── Active event ──────────────────────────────────────────────────────────
  const [eventId, setEventId] = React.useState<string | null>(() => params.get('event') ?? session(EVENT_KEY));
  const event = events.data?.find((e) => e.id === eventId) ?? null;

  React.useEffect(() => {
    if (!events.data) return;
    if (eventId && !events.data.some((e) => e.id === eventId)) setEventId(null); // no longer assigned
    else if (!eventId && events.data.length === 1) setEventId(events.data[0].id);
  }, [events.data, eventId]);

  React.useEffect(() => {
    session(EVENT_KEY, eventId);
    if (params.has('event')) setParams({}, { replace: true });
  }, [eventId, params, setParams]);

  // ── Scan state ────────────────────────────────────────────────────────────
  const [outcome, setOutcome] = React.useState<ScanOutcome | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [lastOk, setLastOk] = React.useState(true);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [count, setCount] = React.useState(0);
  const [last, setLast] = React.useState<CheckInResponse | null>(null);
  const inFlight = React.useRef(false);
  const lastBody = React.useRef<CheckInBody | null>(null);

  React.useEffect(() => {
    setCount(eventId ? Number(session(COUNT_KEY(eventId))) || 0 : 0);
    setLast(null);
    setOutcome(null);
  }, [eventId]);

  const summary = useQuery({
    queryKey: ['scanner', 'summary', eventId],
    queryFn: () => api.get<{ checkedIn: number; capacity: number | null }>(`/scanner/events/${eventId}/summary`),
    enabled: Boolean(eventId),
    refetchInterval: 20_000,
  });

  /**
   * Sends one ticket to the server and shows ONLY what the server answered.
   * No response (offline, timeout, 5xx) is never treated as an entry.
   */
  const submit = React.useCallback(
    async (body: CheckInBody) => {
      if (!eventId || inFlight.current) return;
      inFlight.current = true;
      lastBody.current = body;
      setChecking(true);
      setSearchOpen(false);
      try {
        const response = await api.post<CheckInResponse>(`/scanner/events/${eventId}/check-in`, body, { timeoutMs: CHECK_IN_TIMEOUT_MS });
        setLastOk(true);
        setLast(response);
        if (response.result === 'ADMITTED') {
          signalSuccess();
          setCount((c) => {
            const next = c + 1;
            session(COUNT_KEY(eventId), String(next));
            return next;
          });
          void queryClient.invalidateQueries({ queryKey: ['scanner', 'summary', eventId] });
        } else {
          signalRejected();
        }
        setOutcome({ kind: 'server', response });
      } catch (err) {
        signalRejected();
        if (err instanceof ApiError && err.status === 404) {
          // Event access was removed (or the event was deleted) mid-shift.
          setEventId(null);
          void events.refetch();
        } else if (err instanceof ApiError && err.status === 401) {
          navigate('/login', { replace: true });
        } else {
          setLastOk(!(err instanceof NetworkError) && !(err instanceof ApiError && err.status >= 500) ? true : false);
          setOutcome({ kind: 'network' });
        }
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [eventId, events, navigate, queryClient],
  );

  const onDetect = React.useCallback(
    (text: string) => {
      // The QR content is validated locally first: anything that is not one of
      // our ticket links is rejected by the server as "invalid" without a lookup.
      void submit({ token: extractTicketToken(text) ?? text.slice(0, 500) });
    },
    [submit],
  );

  const paused = !event || checking || outcome !== null || searchOpen;
  const camera = useQrScanner(onDetect, paused);
  const { start: startCamera, stop: stopCamera, status: cameraStatus } = camera;

  // Start without a tap only when permission already exists; otherwise wait
  // for the user to press "Uključi kameru".
  React.useEffect(() => {
    if (!event) {
      stopCamera();
      return;
    }
    let cancelled = false;
    void cameraAlreadyGranted().then((granted) => {
      if (granted && !cancelled) void startCamera();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  const dismiss = React.useCallback(() => setOutcome(null), []);
  const retry = React.useCallback(() => {
    const body = lastBody.current;
    setOutcome(null);
    if (body) void submit(body);
  }, [submit]);

  async function handleLogout() {
    stopCamera();
    await logout().catch(() => undefined);
    navigate('/login', { replace: true });
  }

  // ── Event picker ──────────────────────────────────────────────────────────
  if (!event) {
    return (
      <div className="safe-top safe-bottom flex min-h-dvh flex-col bg-navy text-navy-text">
        <header className="flex items-center justify-between px-5 py-4">
          <div>
            <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">Skener ulaznica</div>
            <div className="mt-0.5 text-sm text-navy-muted">
              {user.firstName} {user.lastName}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {user.role !== 'SCANNER' && (
              <Link to="/dashboard" className="rounded-md p-2.5 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Nazad na administraciju">
                <ArrowLeft className="size-5" />
              </Link>
            )}
            <button type="button" onClick={handleLogout} className="rounded-md p-2.5 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Odjavi se">
              <LogOut className="size-5" />
            </button>
          </div>
        </header>
        <main className="flex-1 px-5 pb-8">
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Izaberi događaj</h1>
          <p className="mt-1.5 text-sm text-navy-muted">Karte važe samo za događaj koji izabereš ovde.</p>
          <div className="mt-6">
            {events.isPending ? (
              <div className="flex justify-center py-16">
                <Spinner className="size-6 text-navy-muted" />
              </div>
            ) : events.isError ? (
              <div role="alert" className="rounded-lg border border-navy-line bg-navy-raised p-5 text-center">
                <WifiOff className="mx-auto size-7 text-navy-muted" aria-hidden />
                <p className="mt-3 font-semibold">Događaji nisu učitani</p>
                <p className="mt-1 text-sm text-navy-muted">{errorMessage(events.error)}</p>
                <button type="button" onClick={() => events.refetch()} className="mt-4 h-11 rounded-md bg-navy-text px-5 text-sm font-bold text-navy">
                  Pokušaj ponovo
                </button>
              </div>
            ) : events.data.length === 0 ? (
              <div className="rounded-lg border border-navy-line bg-navy-raised p-6 text-center">
                <Camera className="mx-auto size-7 text-navy-muted" strokeWidth={1.5} aria-hidden />
                <p className="mt-3 font-semibold">Nema dodeljenih događaja</p>
                <p className="mt-1 text-sm leading-relaxed text-navy-muted">Trenutno nisi dodeljen/a nijednom aktivnom događaju. Javi se organizatoru da ti dodeli pristup.</p>
              </div>
            ) : (
              <ul className="space-y-3">
                {events.data.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => {
                        unlockAudio();
                        setEventId(e.id);
                      }}
                      className="w-full rounded-lg border border-navy-line bg-navy-raised px-5 py-4 text-left transition-colors hover:border-navy-muted focus-visible:ring-offset-navy"
                    >
                      <div className="text-lg font-bold">{e.name}</div>
                      <div className="mt-1 text-sm text-navy-muted">
                        {formatDateShort(e.startsAt)} u {formatTime(e.startsAt)} · {e.venueName}
                      </div>
                      {e.status !== 'ACTIVE' && <div className="mt-2 text-xs font-semibold text-accent">U nacrtu — skeniranje radi tek kada organizator aktivira događaj</div>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Scanner ───────────────────────────────────────────────────────────────
  const connected = online && lastOk;
  const multipleEvents = (events.data?.length ?? 0) > 1;

  return (
    <div className="safe-top safe-bottom fixed inset-0 flex flex-col bg-[#05080F] text-navy-text">
      {/* Top bar: which event, and whether the server is reachable */}
      <header className="relative z-10 flex items-center gap-3 bg-navy px-4 py-3">
        <button
          type="button"
          onClick={() => multipleEvents && setEventId(null)}
          disabled={!multipleEvents}
          className="min-w-0 flex-1 rounded-md text-left focus-visible:ring-offset-navy"
          aria-label={multipleEvents ? `Aktivan događaj: ${event.name}. Promeni događaj` : `Aktivan događaj: ${event.name}`}
        >
          <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-accent">Događaj</div>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-lg font-bold leading-tight">{event.name}</span>
            {multipleEvents && <ChevronDown className="size-4 shrink-0 text-navy-muted" aria-hidden />}
          </div>
        </button>
        <div
          role="status"
          className={cn('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold', connected ? 'bg-[#0B7A4B]/25 text-[#6EE7B7]' : 'bg-[#B3261E] text-white')}
        >
          {connected ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}
          {connected ? 'Povezano' : 'Nema veze'}
        </div>
        <Link to="/scanner/history" className="rounded-md p-2 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Istorija skeniranja">
          <History className="size-5" />
        </Link>
      </header>

      {/* Camera */}
      <div className="relative flex-1 overflow-hidden">
        <video ref={camera.videoRef} className={cn('absolute inset-0 size-full object-cover', cameraStatus !== 'scanning' && 'invisible')} playsInline muted aria-label="Slika sa kamere" />

        {cameraStatus === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
            {/* Large scanning frame; the surrounding shade focuses the eye. */}
            <div className="relative aspect-square w-[min(78vw,60vh)] rounded-2xl shadow-[0_0_0_100vmax_rgba(5,8,15,0.55)]">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-2xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-2xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl', 'bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl'].map(
                (corner) => (
                  <span key={corner} className={cn('absolute size-12 border-accent', corner)} />
                ),
              )}
            </div>
          </div>
        )}
        {cameraStatus === 'scanning' && !checking && (
          <p className="absolute inset-x-0 bottom-5 text-center text-sm font-semibold text-white drop-shadow">Usmeri kameru ka QR kodu ulaznice</p>
        )}

        {checking && (
          <div role="status" className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#05080F]/85">
            <Spinner className="size-10 text-accent" label="Provera karte" />
            <p className="mt-4 text-lg font-bold">Provera karte…</p>
          </div>
        )}

        {cameraStatus !== 'scanning' && !checking && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
            {cameraStatus === 'starting' ? (
              <>
                <Spinner className="size-8 text-navy-muted" label="Pokretanje kamere" />
                <p className="mt-4 text-sm text-navy-muted">Pokretanje kamere…</p>
              </>
            ) : cameraStatus === 'idle' ? (
              <>
                <Camera className="size-12 text-navy-muted" strokeWidth={1.25} aria-hidden />
                <p className="mt-4 max-w-xs text-sm leading-relaxed text-navy-muted">Za skeniranje QR kodova potreban je pristup kameri. Slika se ne snima i ne šalje nikuda.</p>
                <button
                  type="button"
                  onClick={() => {
                    unlockAudio();
                    void startCamera();
                  }}
                  className="mt-6 flex h-14 items-center gap-2 rounded-lg bg-accent px-8 text-lg font-bold text-navy active:opacity-90"
                >
                  <Camera className="size-5" aria-hidden /> Uključi kameru
                </button>
              </>
            ) : (
              <div role="alert" className="max-w-sm">
                <CameraOff className="mx-auto size-12 text-navy-muted" strokeWidth={1.25} aria-hidden />
                <p className="mt-4 text-lg font-bold">
                  {cameraStatus === 'denied' ? 'Pristup kameri je odbijen' : cameraStatus === 'no-camera' ? 'Kamera nije pronađena' : cameraStatus === 'insecure' ? 'Kamera traži bezbednu vezu' : 'Kamera nije pokrenuta'}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-navy-muted">
                  {cameraStatus === 'denied'
                    ? 'Dozvoli pristup kameri u podešavanjima pregledača za ovaj sajt, pa pokušaj ponovo. U međuvremenu možeš da prijaviš gosta ručnom pretragom.'
                    : cameraStatus === 'no-camera'
                      ? 'Ovaj uređaj nema dostupnu kameru. Koristi ručnu pretragu.'
                      : cameraStatus === 'insecure'
                        ? 'Pregledači dozvoljavaju kameru samo preko HTTPS veze. Otvori skener preko https:// adrese.'
                        : 'Zatvori druge aplikacije koje koriste kameru i pokušaj ponovo.'}
                </p>
                {cameraStatus !== 'insecure' && (
                  <button type="button" onClick={() => void startCamera()} className="mt-5 h-12 rounded-lg bg-navy-text px-6 text-base font-bold text-navy">
                    Pokušaj ponovo
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom: session numbers, last result, controls */}
      <footer className="relative z-10 bg-navy px-4 pb-3 pt-3">
        <div className="flex items-stretch gap-3">
          <div className="rounded-md bg-navy-raised px-3 py-2">
            <div className="text-2xs font-semibold uppercase tracking-wider text-navy-muted">Moja sesija</div>
            <div className="tabular text-2xl font-extrabold leading-tight" aria-label={`Uspešnih skeniranja u ovoj sesiji: ${count}`}>
              {formatNumber(count)}
            </div>
          </div>
          <div className="rounded-md bg-navy-raised px-3 py-2">
            <div className="text-2xs font-semibold uppercase tracking-wider text-navy-muted">Ukupno ušlo</div>
            <div className="tabular text-2xl font-extrabold leading-tight">
              {summary.data ? formatNumber(summary.data.checkedIn) : '–'}
              {summary.data?.capacity ? <span className="text-sm font-semibold text-navy-muted"> / {formatNumber(summary.data.capacity)}</span> : null}
            </div>
          </div>
          <div className="min-w-0 flex-1 rounded-md bg-navy-raised px-3 py-2" aria-live="polite">
            <div className="text-2xs font-semibold uppercase tracking-wider text-navy-muted">Poslednje</div>
            {last ? (
              <>
                <div className={cn('truncate text-sm font-bold', last.result === 'ADMITTED' ? 'text-[#6EE7B7]' : 'text-[#FCA5A5]')}>{last.ticket?.guestName ?? last.title}</div>
                <div className="tabular truncate text-xs text-navy-muted">
                  {formatTime(last.scannedAt)} · {last.result === 'ADMITTED' ? last.ticket?.ticketType.name : last.title.toLowerCase()}
                </div>
              </>
            ) : (
              <div className="mt-1 text-sm text-navy-muted">Još nema skeniranja</div>
            )}
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-navy-raised text-base font-bold active:bg-navy-line focus-visible:ring-offset-navy"
          >
            <Search className="size-5" aria-hidden /> Ručna pretraga
          </button>
          {camera.torchSupported && (
            <button
              type="button"
              onClick={camera.toggleTorch}
              aria-pressed={camera.torchOn}
              aria-label={camera.torchOn ? 'Isključi lampu' : 'Uključi lampu'}
              className={cn('flex size-12 items-center justify-center rounded-lg focus-visible:ring-offset-navy', camera.torchOn ? 'bg-accent text-navy' : 'bg-navy-raised')}
            >
              {camera.torchOn ? <Flashlight className="size-5" /> : <FlashlightOff className="size-5" />}
            </button>
          )}
          {camera.devices.length > 1 && (
            <button type="button" onClick={camera.switchCamera} aria-label="Promeni kameru" className="flex size-12 items-center justify-center rounded-lg bg-navy-raised focus-visible:ring-offset-navy">
              <SwitchCamera className="size-5" />
            </button>
          )}
        </div>
      </footer>

      <ManualSearch eventId={event.id} open={searchOpen} onOpenChange={setSearchOpen} onCheckIn={(ticketId) => void submit({ ticketId })} />
      {outcome && <ScanResultView outcome={outcome} onDismiss={dismiss} onRetry={outcome.kind === 'network' ? retry : undefined} />}
    </div>
  );
}

// ── Manual search (damaged screen, dead phone battery, printed ticket …) ────

function ManualSearch({ eventId, open, onOpenChange, onCheckIn }: { eventId: string; open: boolean; onOpenChange: (o: boolean) => void; onCheckIn: (ticketId: string) => void }) {
  const [q, setQ] = React.useState('');
  const [confirming, setConfirming] = React.useState<ScannerSearchResultDto | null>(null);
  const term = useDebouncedValue(q.trim(), 350);

  React.useEffect(() => {
    if (open) {
      setQ('');
      setConfirming(null);
    }
  }, [open]);

  const results = useQuery({
    queryKey: ['scanner', 'search', eventId, term],
    queryFn: () => api.get<ScannerSearchResultDto[]>(`/scanner/events/${eventId}/search?q=${encodeURIComponent(term)}`, { timeoutMs: CHECK_IN_TIMEOUT_MS }),
    enabled: open && term.length >= 2,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content className="safe-top safe-bottom fixed inset-0 z-40 flex flex-col bg-navy text-navy-text data-[state=open]:animate-fade-in">
          <div className="flex items-center gap-2 px-4 py-3">
            <DialogPrimitive.Title className="flex-1 text-lg font-bold">Ručna pretraga</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Pronađi gosta po imenu ili broju karte</DialogPrimitive.Description>
            <DialogPrimitive.Close className="rounded-md p-2 text-navy-muted hover:text-navy-text focus-visible:ring-offset-navy" aria-label="Zatvori pretragu">
              <X className="size-6" />
            </DialogPrimitive.Close>
          </div>
          <div className="px-4">
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ime, prezime ili broj karte"
              aria-label="Ime, prezime ili broj karte"
              autoComplete="off"
              autoCapitalize="words"
              className="h-14 w-full rounded-lg border border-navy-line bg-navy-raised px-4 text-lg text-navy-text placeholder:text-navy-muted focus-visible:border-accent focus-visible:ring-0"
            />
          </div>
          <div className="mt-3 flex-1 overflow-y-auto px-4 pb-6">
            {term.length < 2 ? (
              <p className="px-1 py-6 text-sm text-navy-muted">Unesi najmanje dva znaka.</p>
            ) : results.isPending ? (
              <div className="flex justify-center py-10">
                <Spinner className="size-6 text-navy-muted" />
              </div>
            ) : results.isError ? (
              <p role="alert" className="rounded-lg bg-[#B3261E] px-4 py-3 text-sm font-semibold text-white">
                Pretraga nije uspela — proveri internet konekciju.
              </p>
            ) : results.data.length === 0 ? (
              <p className="px-1 py-6 text-sm text-navy-muted">Nema karata za „{term}” na ovom događaju.</p>
            ) : (
              <ul className="space-y-2">
                {results.data.map((ticket) => {
                  const valid = ticket.status === 'VALID';
                  return (
                    <li key={ticket.ticketId}>
                      <button
                        type="button"
                        disabled={!valid}
                        onClick={() => setConfirming(ticket)}
                        className={cn('flex w-full items-center gap-3 rounded-lg border border-navy-line bg-navy-raised px-4 py-3 text-left focus-visible:ring-offset-navy', !valid && 'opacity-55')}
                      >
                        <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ backgroundColor: ticket.ticketType.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-bold">{ticket.guestName}</span>
                          <span className="block text-sm text-navy-muted">
                            {ticket.ticketType.name} · <span className="font-mono">{ticket.reference}</span>
                          </span>
                        </span>
                        <span className={cn('shrink-0 text-xs font-bold uppercase', valid ? 'text-[#6EE7B7]' : 'text-[#FCA5A5]')}>
                          {TICKET_STATUS_LABELS[ticket.status]}
                          {ticket.usedAt && <span className="tabular block text-right font-medium normal-case text-navy-muted">{formatTime(ticket.usedAt)}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {confirming && (
            <div className="safe-bottom border-t border-navy-line bg-navy-raised px-4 py-4" role="region" aria-label="Potvrda ručnog ulaska">
              <p className="text-sm text-navy-muted">Proveri identitet gosta, pa potvrdi ulazak:</p>
              <p className="mt-1 text-lg font-bold">
                {confirming.guestName} · {confirming.ticketType.name}
              </p>
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={() => setConfirming(null)} className="h-12 flex-1 rounded-lg border border-navy-line text-base font-bold">
                  Odustani
                </button>
                <button type="button" onClick={() => onCheckIn(confirming.ticketId)} className="h-12 flex-[2] rounded-lg bg-accent text-base font-bold text-navy">
                  Potvrdi ulazak
                </button>
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
