import type { EmailStatus } from '@event-platform/shared';
import type { ProviderEmailEvent } from '../email/email.types';

// Pure rules for the e-mail delivery state machine.
//
// Provider webhooks may arrive late, twice, or out of order. Each status has
// a rank and a delivery only ever moves to a HIGHER rank, so:
//   • a duplicate event is a no-op,
//   • "sent" arriving after "delivered" is ignored,
//   • "delivered" arriving after "bounced" is ignored.

const RANK: Record<EmailStatus, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  BOUNCED: 4,
  FAILED: 4,
};

export function canTransition(from: EmailStatus, to: EmailStatus): boolean {
  return RANK[to] > RANK[from];
}

/** Statuses from which `to` may be entered – used as the WHERE guard of the atomic update. */
export function allowedPredecessors(to: EmailStatus): EmailStatus[] {
  return (Object.keys(RANK) as EmailStatus[]).filter((from) => canTransition(from, to));
}

/** Which status (if any) a provider event moves a delivery to. */
export function targetStatus(type: ProviderEmailEvent['type']): EmailStatus | null {
  switch (type) {
    case 'sent':
      return 'SENT';
    case 'delivered':
      return 'DELIVERED';
    case 'bounced':
      return 'BOUNCED';
    case 'failed':
      return 'FAILED';
    default:
      // complained / delivery_delayed annotate the delivery without changing its status
      return null;
  }
}

/** A delivery that is on its way – sending again right now would be a duplicate. */
export const IN_FLIGHT: EmailStatus[] = ['QUEUED', 'SENDING'];
/** A delivery the provider accepted or delivered – "send" (not "resend") skips these. */
export const ALREADY_SENT: EmailStatus[] = ['SENT', 'DELIVERED'];
