import { isTicketToken, type PublicTicketDto } from '@event-platform/shared';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Ban, CalendarDays, CheckCircle2, Clock, Download, MapPin, Printer, Sun, TicketX, WifiOff } from 'lucide-react';
import * as React from 'react';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/controls';
import { api, ApiError } from '@/lib/api';
import { downloadFile } from '@/lib/download';
import { formatDateTime, formatDateWithWeekday, formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type Notice = { tone: 'danger' | 'info'; icon: React.ComponentType<{ className?: string }>; title: string; text: string };

/** Anything that makes the ticket unusable at the door is said plainly, above the QR code. */
export function ticketNotice(ticket: PublicTicketDto): Notice | null {
  if (ticket.status === 'REVOKED') {
    return { tone: 'danger', icon: Ban, title: 'Karta je poništena', text: 'Organizator je poništio ovu kartu i ona više ne važi na ulazu.' };
  }
  if (ticket.event.status === 'CANCELLED') {
    return { tone: 'danger', icon: AlertTriangle, title: 'Događaj je otkazan', text: 'Ova karta više ne važi. Za više informacija obrati se organizatoru.' };
  }
  if (ticket.status === 'USED') {
    return {
      tone: 'info',
      icon: CheckCircle2,
      title: 'Karta je iskorišćena',
      text: ticket.usedAt ? `Ulazak je zabeležen ${formatDateTime(ticket.usedAt)}. Karta važi za jedan ulazak.` : 'Karta važi za jedan ulazak.',
    };
  }
  if (ticket.expired) return { tone: 'danger', icon: Clock, title: 'Karta je istekla', text: 'Rok važenja ove karte je prošao.' };
  if (ticket.event.status === 'COMPLETED') return { tone: 'info', icon: Clock, title: 'Događaj je završen', text: 'Hvala što si bio/la sa nama.' };
  return null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="safe-top safe-bottom flex min-h-dvh flex-col items-center bg-navy px-4 py-6 text-navy-text print:bg-white print:py-0">{children}</div>;
}

function Message({ icon: Icon, title, text, action }: { icon: React.ComponentType<{ className?: string }>; title: string; text: string; action?: React.ReactNode }) {
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Icon className="size-12 text-navy-muted" aria-hidden />
        <h1 className="mt-5 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-navy-muted">{text}</p>
        {action && <div className="mt-6">{action}</div>}
      </div>
    </Shell>
  );
}

const QR_CANVAS_PX = 720;

/**
 * The QR code, painted onto a <canvas>.
 *
 * Samsung Internet's dark mode cannot be switched off by a page: it recolours
 * CSS backgrounds, SVG fills and "simple" images, which turned the code into
 * grey-on-grey that scanners could not read. Pixels drawn on a canvas are not
 * part of the styled document, so they are shown exactly as drawn – white
 * background and quiet zone included. The plain <img> stays as the fallback
 * until the canvas is painted (and wherever canvas is unavailable).
 */
function QrCode({ src, label }: { src: string; label: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [painted, setPainted] = React.useState(false);

  React.useEffect(() => {
    setPainted(false);
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      const canvas = canvasRef.current;
      if (cancelled || !canvas) return;
      try {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // Extra white around the image, so the quiet zone never depends on the page behind it.
        const pad = Math.round(QR_CANVAS_PX * 0.04);
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, QR_CANVAS_PX, QR_CANVAS_PX);
        ctx.drawImage(image, pad, pad, QR_CANVAS_PX - 2 * pad, QR_CANVAS_PX - 2 * pad);
        setPainted(true);
      } catch {
        /* keep the <img> fallback */
      }
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return (
    <>
      <canvas ref={canvasRef} width={QR_CANVAS_PX} height={QR_CANVAS_PX} role="img" aria-label={label} className={cn('aspect-square w-full', !painted && 'hidden')} />
      {!painted && <img src={src} alt={label} className="aspect-square w-full" />}
    </>
  );
}

/**
 * The guest's digital ticket. Public, but reachable only through its
 * unguessable link. Strictly read-only: opening, refreshing, downloading or
 * printing this page never marks the ticket as used – only a scan by signed-in
 * entrance staff does. No analytics or third-party resources are loaded here,
 * so the link never leaves the guest's device.
 */
export function TicketPage() {
  const { token = '' } = useParams();
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [saving, setSaving] = React.useState(false);
  const wellFormed = isTicketToken(token);

  const query = useQuery({
    // The token is deliberately NOT part of a persisted cache; it lives in memory only.
    queryKey: ['public-ticket', token],
    queryFn: () => api.get<PublicTicketDto>(`/public/tickets/${token}`, { skipRefresh: true }),
    enabled: wellFormed,
    retry: (count, error) => !(error instanceof ApiError) && count < 2,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  React.useEffect(() => {
    const previous = document.title;
    if (query.data) document.title = `Ulaznica — ${query.data.event.name}`;
    return () => {
      document.title = previous;
    };
  }, [query.data]);

  if (!wellFormed || (query.error instanceof ApiError && query.error.status === 404)) {
    return <Message icon={TicketX} title="Ulaznica nije pronađena" text="Link nije ispravan ili ulaznica više ne postoji. Otvori link direktno iz pozivnice koju si dobio/la mejlom." />;
  }
  if (query.isPending) {
    return (
      <Shell>
        <div className="flex flex-1 items-center">
          <Spinner className="size-7 text-navy-muted" label="Učitavanje ulaznice" />
        </div>
      </Shell>
    );
  }
  if (query.isError) {
    return (
      <Message
        icon={WifiOff}
        title="Ulaznica nije učitana"
        text={query.error instanceof ApiError && query.error.status === 429 ? 'Previše pokušaja. Sačekaj minut pa pokušaj ponovo.' : 'Proveri internet konekciju i pokušaj ponovo.'}
        action={
          <button type="button" onClick={() => query.refetch()} className="h-12 rounded-lg bg-navy-text px-6 text-base font-bold text-navy">
            Pokušaj ponovo
          </button>
        }
      />
    );
  }

  const ticket = query.data;
  const notice = ticketNotice(ticket);
  const usable = notice === null;
  // The PNG survives forced dark mode (see PublicTicketDto.qrPng); SVG is the fallback for an older API.
  const qrSrc = ticket.qrPng ?? `data:image/svg+xml;utf8,${encodeURIComponent(ticket.qrSvg)}`;

  async function saveImage() {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      // Loaded on demand: most guests only ever show the QR code.
      const { toPng } = await import('html-to-image');
      const dataUrl = await toPng(cardRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: '#0D1524' });
      downloadFile(dataUrl, `ulaznica-${ticket.reference}.png`);
    } catch {
      toast.error('Slika nije sačuvana. Napravi snimak ekrana umesto toga.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Shell>
      <main className="w-full max-w-[400px]">
        <p className="mb-4 text-center text-2xs font-semibold uppercase tracking-[0.18em] text-navy-muted print:hidden">{ticket.event.organizerName}</p>

        {/* The padded wrapper is what gets exported as an image. */}
        <div ref={cardRef} className="bg-navy p-1 print:bg-white">
          <article className="overflow-hidden rounded-2xl bg-[#FBFAF6] text-[#131A26]" aria-label="Ulaznica">
            {ticket.event.coverImageUrl ? (
              <img src={ticket.event.coverImageUrl} alt="" className="aspect-[2/1] w-full object-cover" />
            ) : (
              <div className="h-2 w-full" style={{ backgroundColor: ticket.ticketType.color }} aria-hidden />
            )}

            <div className="px-6 pb-5 pt-6">
              {/* Inside the card, so the logo is part of the saved image and the printout. */}
              {ticket.event.organizerLogoUrl && (
                <img src={ticket.event.organizerLogoUrl} alt={ticket.event.organizerName} className="mb-4 h-10 max-w-[160px] object-contain object-left" />
              )}
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-balance text-[26px] font-extrabold leading-[1.15] tracking-tight">{ticket.event.name}</h1>
                <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-[#131A26]/15 px-2.5 py-1 text-sm font-extrabold uppercase tracking-wide">
                  <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: ticket.ticketType.color }} />
                  {ticket.ticketType.name}
                </span>
              </div>
              <dl className="mt-4 space-y-2 text-[15px]">
                <div className="flex items-start gap-2.5">
                  <CalendarDays className="mt-0.5 size-4 shrink-0 text-[#5E6675]" aria-hidden />
                  <div>
                    <dt className="sr-only">Datum i vreme</dt>
                    <dd className="font-semibold">
                      {formatDateWithWeekday(ticket.event.startsAt)} u {formatTime(ticket.event.startsAt)}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-[#5E6675]" aria-hidden />
                  <div>
                    <dt className="sr-only">Lokacija</dt>
                    <dd className="font-semibold">{ticket.event.venueName}</dd>
                    {ticket.event.venueAddress && <dd className="text-sm text-[#5E6675]">{ticket.event.venueAddress}</dd>}
                  </div>
                </div>
              </dl>
            </div>

            {/* Perforation */}
            <div className="relative h-6" aria-hidden>
              <span className="absolute -left-3 top-0 size-6 rounded-full bg-navy print:bg-white" />
              <span className="absolute -right-3 top-0 size-6 rounded-full bg-navy print:bg-white" />
              <span className="absolute inset-x-6 top-1/2 border-t-2 border-dashed border-[#131A26]/20" />
            </div>

            <div className="px-6 pb-6 pt-3">
              {notice && (
                <div
                  role="status"
                  className={cn(
                    'mb-4 flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm',
                    notice.tone === 'danger' ? 'bg-[#B3261E] text-white' : 'bg-[#131A26] text-white',
                  )}
                >
                  <notice.icon className="mt-0.5 size-5 shrink-0" aria-hidden />
                  <div>
                    <div className="font-bold">{notice.title}</div>
                    <div className="mt-0.5 opacity-90">{notice.text}</div>
                  </div>
                </div>
              )}

              {/*
                White quiet zone + maximum contrast: scans reliably even on dim screens.
                The quiet zone is part of the image itself; the tile's white is painted as a
                gradient because forced dark mode darkens background colours but not background images.
              */}
              <div
                className={cn('mx-auto w-full max-w-[280px] overflow-hidden rounded-xl bg-white p-1', !usable && 'opacity-35 grayscale')}
                style={{ backgroundImage: 'linear-gradient(#fff, #fff)', colorScheme: 'only light' }}
              >
                <QrCode src={qrSrc} label={usable ? 'QR kod ulaznice — pokaži ga na ulazu' : 'QR kod ulaznice (karta više ne važi)'} />
              </div>

              <div className="mt-5 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-2xs font-semibold uppercase tracking-[0.12em] text-[#5E6675]">Gost</div>
                  <div className="truncate text-lg font-bold leading-tight">{ticket.guestName}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-2xs font-semibold uppercase tracking-[0.12em] text-[#5E6675]">Broj karte</div>
                  <div className="font-mono text-[15px] font-semibold leading-tight">{ticket.reference}</div>
                </div>
              </div>

              {ticket.ticketType.instructions && <p className="mt-4 border-t border-[#131A26]/10 pt-3 text-sm leading-relaxed text-[#3A4353]">{ticket.ticketType.instructions}</p>}
            </div>
          </article>
        </div>

        {usable && (
          <p className="mt-5 flex items-center justify-center gap-2 text-sm text-navy-muted print:hidden">
            <Sun className="size-4 shrink-0" aria-hidden /> Na ulazu pojačaj osvetljenje ekrana i pokaži QR kod.
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 print:hidden">
          <button
            type="button"
            onClick={saveImage}
            disabled={saving}
            className="flex h-12 items-center justify-center gap-2 rounded-lg bg-navy-text text-[15px] font-bold text-navy focus-visible:ring-offset-navy disabled:opacity-70"
          >
            {saving ? <Spinner className="size-4 text-navy" /> : <Download className="size-4" aria-hidden />} Sačuvaj sliku
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-12 items-center justify-center gap-2 rounded-lg border border-navy-line text-[15px] font-bold focus-visible:ring-offset-navy"
          >
            <Printer className="size-4" aria-hidden /> Štampaj / PDF
          </button>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-navy-muted print:hidden">
          Ova karta važi za jednu osobu i jedan ulazak. Ko ima link, može da je iskoristi — ne deli ga javno.
        </p>
      </main>
    </Shell>
  );
}
