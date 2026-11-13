import type { InvitationPreviewDto, InvitationSummaryDto, SendInvitationsResult } from '@event-platform/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Send } from 'lucide-react';
import * as React from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { ErrorState } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { uuid } from '@/lib/utils';
import { eventKeys } from '../event-queries';

/** Describes the outcome of a send in one sentence for the toast. */
export function describeSendResult(result: SendInvitationsResult): { title: string; description?: string } {
  const parts: string[] = [];
  if (result.ticketsGenerated > 0) {
    parts.push(`Generisano ${formatNumber(result.ticketsGenerated)} ${plural(result.ticketsGenerated, 'nova karta', 'nove karte', 'novih karata')}.`);
  }
  if (result.skippedAlreadySent > 0) {
    parts.push(`${formatNumber(result.skippedAlreadySent)} ${plural(result.skippedAlreadySent, 'gost je preskočen', 'gosta su preskočena', 'gostiju je preskočeno')} — pozivnica je već poslata ili je slanje u toku.`);
  }
  if (result.skippedNoTickets > 0) {
    parts.push(`${formatNumber(result.skippedNoTickets)} bez važećih karata.`);
  }
  if (result.queued === 0) {
    return { title: 'Nijedna pozivnica nije poslata', description: parts.join(' ') || undefined };
  }
  return {
    title: `${formatNumber(result.queued)} ${plural(result.queued, 'pozivnica je u redu za slanje', 'pozivnice su u redu za slanje', 'pozivnica je u redu za slanje')}`,
    description: parts.join(' ') || 'Status isporuke prati u koloni „Pozivnica".',
  };
}

interface EmailPreviewDialogProps {
  eventId: string;
  /** Guest whose personalized e-mail is shown; omitted = first guest of the event. */
  eventGuestId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Shows exactly what the guest will receive, rendered by the same template the sender uses. */
export function EmailPreviewDialog({ eventId, eventGuestId, open, onOpenChange }: EmailPreviewDialogProps) {
  const preview = useQuery({
    queryKey: ['event', eventId, 'invitation-preview', eventGuestId ?? 'sample'],
    queryFn: () => api.post<InvitationPreviewDto>(`/events/${eventId}/invitations/preview`, eventGuestId ? { eventGuestId } : {}),
    enabled: open,
    staleTime: 0,
    gcTime: 0,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader title="Pregled pozivnice" description="Ovako će poruka izgledati u sandučetu gosta." />
        <DialogBody className="bg-subtle/40">
          {preview.isPending ? (
            <div className="space-y-3" aria-busy="true">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-[420px] w-full" />
            </div>
          ) : preview.isError ? (
            <ErrorState error={preview.error} onRetry={() => preview.refetch()} />
          ) : (
            <div className="space-y-3">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-muted">Prima:</dt>
                <dd className="truncate font-medium">{preview.data.to}</dd>
                <dt className="text-ink-muted">Naslov:</dt>
                <dd className="font-semibold">{preview.data.subject}</dd>
              </dl>
              {/* Fully sandboxed: the template can neither run scripts nor reach the app. */}
              <iframe
                title="Pregled pozivnice"
                sandbox=""
                srcDoc={preview.data.html}
                className="h-[60vh] min-h-[360px] w-full rounded-md border border-line bg-white"
              />
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Zatvori
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SendInvitationsDialogProps {
  eventId: string;
  eventGuestIds: string[];
  mode: 'SEND' | 'RESEND';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: (result: SendInvitationsResult) => void;
}

/**
 * Confirmation step before sending. Shows what will actually happen
 * (recipients, tickets, event) from a server-side dry run, and offers the
 * e-mail preview. One request id per opened dialog makes a double click or a
 * network retry harmless.
 */
export function SendInvitationsDialog({ eventId, eventGuestIds, mode, open, onOpenChange, onSent }: SendInvitationsDialogProps) {
  const queryClient = useQueryClient();
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const requestId = React.useMemo(() => (open ? uuid() : ''), [open]);

  const summary = useQuery({
    queryKey: ['event', eventId, 'invitation-summary', mode, eventGuestIds],
    queryFn: () => api.post<InvitationSummaryDto>(`/events/${eventId}/invitations/summary`, { eventGuestIds, mode }),
    enabled: open && eventGuestIds.length > 0,
    staleTime: 0,
    gcTime: 0,
  });

  const send = useMutation({
    mutationFn: () => api.post<SendInvitationsResult>(`/events/${eventId}/invitations/send`, { eventGuestIds, requestId, mode }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) });
      const message = describeSendResult(result);
      (result.queued > 0 ? toast.success : toast.info)(message.title, { description: message.description });
      onSent?.(result);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const data = summary.data;
  const resend = mode === 'RESEND';

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !send.isPending && onOpenChange(next)}>
        <DialogContent size="sm">
          <DialogHeader
            title={resend ? 'Ponovno slanje pozivnica' : 'Slanje pozivnica'}
            description={resend ? 'Gosti dobijaju iste karte ponovo — nove karte se ne prave.' : 'Svaki gost dobija ličnu poruku sa svojim QR ulaznicama.'}
          />
          <DialogBody>
            {summary.isPending ? (
              <div className="space-y-3" aria-busy="true">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ) : summary.isError ? (
              <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
            ) : data ? (
              <div className="space-y-4">
                <dl className="divide-y divide-line rounded-md border border-line">
                  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-ink-muted">Događaj</dt>
                    <dd className="truncate text-sm font-semibold">{data.eventName}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-ink-muted">Broj primalaca</dt>
                    <dd className="tabular text-lg font-bold">{formatNumber(data.recipients)}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                    <dt className="text-sm text-ink-muted">Broj karata</dt>
                    <dd className="tabular text-lg font-bold">{formatNumber(data.tickets)}</dd>
                  </div>
                </dl>

                {(data.ticketsToGenerate > 0 || data.skippedAlreadySent > 0 || data.skippedNoTickets > 0) && (
                  <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-muted">
                    {data.ticketsToGenerate > 0 && (
                      <li>
                        Biće generisano {formatNumber(data.ticketsToGenerate)} {plural(data.ticketsToGenerate, 'nova karta', 'nove karte', 'novih karata')} za goste koji ih još nemaju.
                      </li>
                    )}
                    {data.skippedAlreadySent > 0 && (
                      <li>
                        {formatNumber(data.skippedAlreadySent)} {plural(data.skippedAlreadySent, 'gost se preskače', 'gosta se preskaču', 'gostiju se preskače')}
                        {resend ? ' — slanje je već u toku.' : ' — pozivnica je već poslata. Za njih koristi „Pošalji ponovo".'}
                      </li>
                    )}
                    {data.skippedNoTickets > 0 && (
                      <li>
                        {formatNumber(data.skippedNoTickets)} {plural(data.skippedNoTickets, 'gost nema', 'gosta nemaju', 'gostiju nema')} važećih karata i neće dobiti poruku.
                      </li>
                    )}
                  </ul>
                )}

                {data.recipients === 0 && (
                  <p role="status" className="rounded-md border border-line bg-subtle px-3.5 py-3 text-sm font-medium">
                    Nema kome da se pošalje. Proveri izbor gostiju.
                  </p>
                )}

                <Button variant="link" onClick={() => setPreviewOpen(true)}>
                  <Eye /> Pogledaj kako poruka izgleda
                </Button>
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={send.isPending}>
              Odustani
            </Button>
            <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!data || data.recipients === 0}>
              <Send />
              {data && data.recipients > 1
                ? resend
                  ? `Pošalji ponovo (${formatNumber(data.recipients)})`
                  : 'Pošalji izabrane pozivnice'
                : resend
                  ? 'Pošalji ponovo'
                  : 'Pošalji pozivnicu'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <EmailPreviewDialog eventId={eventId} eventGuestId={eventGuestIds[0]} open={previewOpen} onOpenChange={setPreviewOpen} />
    </>
  );
}
