import {
  EMAIL_STATUS_HINTS,
  EMAIL_STATUS_LABELS,
  EVENT_STATUS_LABELS,
  GUEST_TICKET_STATE_LABELS,
  SCAN_RESULT_LABELS,
  TICKET_STATUS_LABELS,
  type EventStatus,
  type GuestEmailStatus,
  type GuestTicketState,
  type ScanResult,
  type TicketStatus,
} from '@event-platform/shared';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip } from './controls';

export type Tone = 'neutral' | 'success' | 'danger' | 'warning' | 'info' | 'muted';

const TONES: Record<Tone, { box: string; dot: string }> = {
  neutral: { box: 'border-line-strong bg-surface text-ink', dot: 'bg-ink' },
  success: { box: 'border-success/25 bg-success-soft text-success', dot: 'bg-success' },
  danger: { box: 'border-danger/25 bg-danger-soft text-danger', dot: 'bg-danger' },
  warning: { box: 'border-warning/25 bg-warning-soft text-warning', dot: 'bg-warning' },
  info: { box: 'border-info/25 bg-info-soft text-info', dot: 'bg-info' },
  muted: { box: 'border-line bg-subtle text-ink-muted', dot: 'bg-ink-faint' },
};

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(({ tone = 'neutral', dot = true, className, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 py-0.5 text-xs font-semibold', TONES[tone].box, className)}
    {...props}
  >
    {dot && <span aria-hidden className={cn('size-1.5 rounded-full', TONES[tone].dot)} />}
    {children}
  </span>
));
Badge.displayName = 'Badge';

const EVENT_TONE: Record<EventStatus, Tone> = { DRAFT: 'muted', ACTIVE: 'success', COMPLETED: 'info', CANCELLED: 'danger' };
export function EventStatusBadge({ status }: { status: EventStatus }) {
  return <Badge tone={EVENT_TONE[status]}>{EVENT_STATUS_LABELS[status]}</Badge>;
}

const TICKET_TONE: Record<TicketStatus, Tone> = { VALID: 'success', USED: 'info', REVOKED: 'danger' };
export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge tone={TICKET_TONE[status]}>{TICKET_STATUS_LABELS[status]}</Badge>;
}

const GUEST_TICKET_TONE: Record<GuestTicketState, Tone> = { NONE: 'muted', VALID: 'success', PARTIALLY_USED: 'info', USED: 'info', REVOKED: 'danger' };
export function GuestTicketBadge({ state }: { state: GuestTicketState }) {
  return <Badge tone={GUEST_TICKET_TONE[state]}>{GUEST_TICKET_STATE_LABELS[state]}</Badge>;
}

const EMAIL_TONE: Record<GuestEmailStatus, Tone> = {
  NOT_SENT: 'muted',
  QUEUED: 'warning',
  SENDING: 'warning',
  // "Sent" is deliberately neutral: accepted by the provider is not yet delivered.
  SENT: 'neutral',
  DELIVERED: 'success',
  BOUNCED: 'danger',
  FAILED: 'danger',
};
export function EmailStatusBadge({ status, error }: { status: GuestEmailStatus; error?: string | null }) {
  return (
    <Tooltip content={error || EMAIL_STATUS_HINTS[status]}>
      <Badge tone={EMAIL_TONE[status]} tabIndex={0} className="cursor-default">
        {EMAIL_STATUS_LABELS[status]}
      </Badge>
    </Tooltip>
  );
}

export function scanResultTone(result: ScanResult): Tone {
  if (result === 'ADMITTED') return 'success';
  if (result === 'ALREADY_USED' || result === 'REVOKED' || result === 'INVALID') return 'danger';
  return 'warning';
}
export function ScanResultBadge({ result }: { result: ScanResult }) {
  return <Badge tone={scanResultTone(result)}>{SCAN_RESULT_LABELS[result]}</Badge>;
}

/** Ticket type marker: the organizer-chosen color as a small swatch next to the name. */
export function TicketTypeTag({ name, color, className }: { name: string; color: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-sm font-medium', className)}>
      <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} />
      {name}
    </span>
  );
}
