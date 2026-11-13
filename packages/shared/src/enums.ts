// String-literal enums shared by the API and the web app. They mirror the
// Prisma enums one-to-one, so values can flow through without mapping.

export const USER_ROLES = ['SUPER_ADMIN', 'ORGANIZER', 'SCANNER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const MEMBERSHIP_ROLES = ['OWNER', 'MEMBER', 'SCANNER'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const EVENT_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const TICKET_STATUSES = ['VALID', 'USED', 'REVOKED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Lifecycle of one e-mail delivery attempt.
 *  QUEUED    – waiting in the background queue
 *  SENDING   – a worker is handing it to the provider
 *  SENT      – the provider ACCEPTED the message (not yet proof of delivery)
 *  DELIVERED – the provider confirmed delivery to the recipient's mail server
 *  BOUNCED   – the recipient's server rejected it
 *  FAILED    – we could not hand it to the provider after all retries
 */
export const EMAIL_STATUSES = ['QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'BOUNCED', 'FAILED'] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** What the guest list shows: latest delivery status, or NOT_SENT when none exists. */
export type GuestEmailStatus = EmailStatus | 'NOT_SENT';
export const GUEST_EMAIL_STATUSES = ['NOT_SENT', ...EMAIL_STATUSES] as const;

export const EMAIL_KINDS = ['INVITATION', 'RESEND'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const SCAN_RESULTS = [
  'ADMITTED',
  'ALREADY_USED',
  'REVOKED',
  'WRONG_EVENT',
  'INVALID',
  'EXPIRED',
  'EVENT_NOT_ACTIVE',
  'EVENT_ENDED',
  'CAPACITY_REACHED',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

export const SCAN_METHODS = ['QR', 'MANUAL'] as const;
export type ScanMethod = (typeof SCAN_METHODS)[number];

/** Aggregated ticket state of one guest on one event (a guest may hold several tickets). */
export const GUEST_TICKET_STATES = ['NONE', 'VALID', 'PARTIALLY_USED', 'USED', 'REVOKED'] as const;
export type GuestTicketState = (typeof GUEST_TICKET_STATES)[number];
