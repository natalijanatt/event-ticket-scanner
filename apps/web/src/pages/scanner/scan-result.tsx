import { NETWORK_ERROR_TITLE, type CheckInResponse, type ScanResult } from '@event-platform/shared';
import { Ban, Check, RotateCw, ShieldAlert, WifiOff, X } from 'lucide-react';
import * as React from 'react';
import { formatDateTime, formatTimeSeconds } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What the scanner shows after one scan: the server's verdict, or a network failure. */
export type ScanOutcome = { kind: 'server'; response: CheckInResponse } | { kind: 'network' };

type Tone = 'success' | 'danger' | 'warning' | 'offline';

const TONE_BY_RESULT: Record<ScanResult, Tone> = {
  ADMITTED: 'success',
  ALREADY_USED: 'danger',
  REVOKED: 'danger',
  INVALID: 'danger',
  EXPIRED: 'danger',
  WRONG_EVENT: 'warning',
  EVENT_NOT_ACTIVE: 'warning',
  EVENT_ENDED: 'warning',
  CAPACITY_REACHED: 'warning',
};

// Saturated full-bleed backgrounds with white text: readable at arm's length,
// in direct sunlight and in a dark club, and distinguishable without relying
// on hue alone (each verdict also has its own icon and wording).
const TONE_CLASS: Record<Tone, string> = {
  success: 'bg-[#0B7A4B]',
  danger: 'bg-[#B3261E]',
  warning: 'bg-[#A85A00]',
  offline: 'bg-[#2B3445]',
};

const HINTS: Partial<Record<ScanResult, string>> = {
  INVALID: 'Ovaj kod nije ulaznica za ovaj sistem.',
  WRONG_EVENT: 'Proveri da li je u skeneru izabran pravi događaj.',
  REVOKED: 'Organizator je poništio ovu kartu.',
  EXPIRED: 'Rok važenja ove karte je prošao.',
  EVENT_NOT_ACTIVE: 'Organizator još nije aktivirao događaj ili ga je otkazao.',
  EVENT_ENDED: 'Skeniranje za ovaj događaj je zatvoreno.',
  CAPACITY_REACHED: 'Dostignut je maksimalan broj gostiju. Javi se organizatoru.',
};

/** Successful scans clear themselves so the queue keeps moving. */
export const AUTO_DISMISS_MS = 2500;

interface ScanResultViewProps {
  outcome: ScanOutcome;
  onDismiss: () => void;
  /** Re-sends the same ticket after a network failure. */
  onRetry?: () => void;
}

export function ScanResultView({ outcome, onDismiss, onRetry }: ScanResultViewProps) {
  const response = outcome.kind === 'server' ? outcome.response : null;
  const tone: Tone = response ? TONE_BY_RESULT[response.result] : 'offline';
  const admitted = response?.result === 'ADMITTED';
  const Icon = !response ? WifiOff : admitted ? Check : tone === 'warning' ? ShieldAlert : response.result === 'REVOKED' ? Ban : X;
  const dismissRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    dismissRef.current?.focus();
    if (!admitted) return;
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [admitted, onDismiss]);

  const ticket = response?.ticket ?? null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="scan-result-title"
      data-testid="scan-result"
      data-tone={tone}
      className={cn('safe-top safe-bottom fixed inset-0 z-50 flex flex-col text-white animate-fade-in', TONE_CLASS[tone])}
    >
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex size-24 items-center justify-center rounded-full bg-white/15">
          <Icon className="size-14" strokeWidth={2.5} aria-hidden />
        </div>
        <h1 id="scan-result-title" className="mt-6 text-balance text-[34px] font-extrabold uppercase leading-[1.1] tracking-tight">
          {response ? response.title : NETWORK_ERROR_TITLE}
        </h1>

        {ticket && (
          <div className="mt-8 w-full max-w-sm">
            <div className="text-[28px] font-bold leading-tight">{ticket.guestName}</div>
            <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-white px-4 py-2 text-xl font-extrabold uppercase tracking-wide text-[#0B1220]">
              <span aria-hidden className="size-3.5 rounded-[3px]" style={{ backgroundColor: ticket.ticketType.color }} />
              {ticket.ticketType.name}
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-white/25 pt-5 text-left">
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wider text-white/70">Karta</dt>
                <dd className="mt-0.5 font-mono text-base font-semibold">{ticket.reference}</dd>
              </div>
              <div className="text-right">
                <dt className="text-xs font-semibold uppercase tracking-wider text-white/70">{admitted ? 'Vreme ulaska' : 'Prvi ulazak'}</dt>
                <dd className="tabular mt-0.5 text-base font-semibold">
                  {ticket.usedAt ? (admitted ? formatTimeSeconds(ticket.usedAt) : formatDateTime(ticket.usedAt)) : '—'}
                </dd>
              </div>
            </dl>
            {admitted && ticket.ticketType.instructions && <p className="mt-4 rounded-md bg-white/15 px-4 py-3 text-left text-sm font-medium">{ticket.ticketType.instructions}</p>}
          </div>
        )}

        {response && !admitted && HINTS[response.result] && <p className="mt-6 max-w-xs text-base font-medium text-white/85">{HINTS[response.result]}</p>}
        {!response && <p className="mt-6 max-w-xs text-base font-medium text-white/85">Karta NIJE proverena. Ne puštaj gosta dok provera ne uspe.</p>}
      </div>

      <div className="space-y-3 px-5 pb-6">
        {!response && onRetry && (
          <button type="button" onClick={onRetry} className="flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-white text-lg font-bold text-[#0B1220] active:bg-white/90">
            <RotateCw className="size-5" aria-hidden /> Pokušaj ponovo
          </button>
        )}
        <button
          ref={dismissRef}
          type="button"
          onClick={onDismiss}
          className={cn(
            'relative flex h-14 w-full items-center justify-center overflow-hidden rounded-lg text-lg font-bold focus-visible:ring-white focus-visible:ring-offset-0',
            !response && onRetry ? 'border-2 border-white/60 text-white' : 'bg-white text-[#0B1220] active:bg-white/90',
          )}
        >
          {admitted && <span aria-hidden className="absolute inset-y-0 left-0 bg-black/10 motion-reduce:hidden" style={{ animation: `scan-countdown ${AUTO_DISMISS_MS}ms linear forwards` }} />}
          <span className="relative">{response ? 'Sledeća karta' : 'Odustani'}</span>
        </button>
      </div>
      <style>{'@keyframes scan-countdown{from{width:0}to{width:100%}}'}</style>
    </div>
  );
}
