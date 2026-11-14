import type {
  EmailKind,
  EmailStatus,
  EventStatus,
  GuestEmailStatus,
  GuestTicketState,
  MembershipRole,
  ScanMethod,
  ScanResult,
  TicketStatus,
  UserRole,
} from './enums';

// Wire types of the REST API. Dates are ISO-8601 strings.

export interface ApiError {
  statusCode: number;
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ── Auth / users ────────────────────────────────────────────────────────────

export interface OrganizerRef {
  id: string;
  name: string;
  role: MembershipRole;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  organizers: OrganizerRef[];
}

export interface OrganizerDto {
  id: string;
  name: string;
  contactEmail: string | null;
  logoUrl: string | null;
  retentionDays: number;
  createdAt: string;
  memberCount: number;
  eventCount: number;
}

export interface UserDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  organizers: { id: string; name: string }[];
}

export interface StaffDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  organizerId: string;
  organizerName: string;
  events: { id: string; name: string }[];
}

export interface AppConfigDto {
  emailMode: 'mock' | 'resend' | 'gmail';
  timezone: string;
}

// ── Events ──────────────────────────────────────────────────────────────────

export interface EventDto {
  id: string;
  organizerId: string;
  organizerName: string;
  name: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  venueName: string;
  venueAddress: string | null;
  coverImageUrl: string | null;
  status: EventStatus;
  capacity: number | null;
  enforceCapacity: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  counts: {
    guests: number;
    /** Issued tickets that are not revoked. */
    tickets: number;
    checkedIn: number;
  };
}

export interface TicketTypeDto {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  capacity: number | null;
  color: string;
  instructions: string | null;
  /** Issued, non-revoked tickets of this type. */
  ticketCount: number;
  /** Tickets allocated to guests (generated or not). */
  allocatedCount: number;
}

export interface TicketTypeRef {
  id: string;
  name: string;
  color: string;
}

// ── Guests ──────────────────────────────────────────────────────────────────

export interface GuestRowDto {
  /** event_guests.id – the guest's participation in THIS event. */
  id: string;
  guestId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  ticketType: TicketTypeRef;
  /** Number of tickets allocated by the organizer. */
  ticketQuantity: number;
  tickets: { valid: number; used: number; revoked: number };
  ticketState: GuestTicketState;
  emailStatus: GuestEmailStatus;
  emailError: string | null;
  lastEmailAt: string | null;
  /** First successful check-in of any of the guest's tickets. */
  firstCheckInAt: string | null;
  createdAt: string;
}

export interface GuestMutationResult {
  guest: GuestRowDto;
  /** True when the e-mail already existed on this event and the row was reused. */
  alreadyOnEvent: boolean;
  ticketsGenerated: number;
  invitationQueued: boolean;
}

export interface BulkGuestsResult {
  created: number;
  /** E-mails already present on this event – left untouched. */
  skippedExisting: string[];
  /** E-mails repeated inside the submitted batch – only the first row is used. */
  duplicatesInBatch: string[];
}

export interface ImportRowDto {
  row: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  notes: string | null;
  ticketTypeName: string | null;
  ticketQuantity: number;
  status: 'OK' | 'DUPLICATE_IN_FILE' | 'ALREADY_ON_EVENT' | 'INVALID';
  error: string | null;
}

export interface ImportResultDto {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  created: number;
  rows: ImportRowDto[];
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export interface TicketRowDto {
  id: string;
  reference: string;
  status: TicketStatus;
  ticketType: TicketTypeRef;
  eventGuestId: string;
  guestName: string;
  guestEmail: string;
  createdAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  scannedByName: string | null;
  revokedAt: string | null;
}

export interface GenerateTicketsResult {
  generated: number;
  guestsAffected: number;
  /** Tickets not created because the ticket type capacity is exhausted. */
  skippedForCapacity: number;
}

export interface RevokeTicketsResult {
  revoked: number;
}

export interface TicketLinkDto {
  url: string;
}

// ── Invitations / e-mail ────────────────────────────────────────────────────

export interface DeliveryRowDto {
  id: string;
  eventGuestId: string;
  guestName: string;
  toEmail: string;
  kind: EmailKind;
  status: EmailStatus;
  subject: string;
  attempts: number;
  lastError: string | null;
  ticketCount: number;
  queuedAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  bouncedAt: string | null;
  failedAt: string | null;
}

export interface SendInvitationsResult {
  queued: number;
  /** Already invited (SEND mode) or currently in flight – nothing was sent. */
  skippedAlreadySent: number;
  /** Guests without a valid ticket – nothing to send. */
  skippedNoTickets: number;
  ticketsGenerated: number;
}

/** What a send would do, computed without sending – shown in the confirmation dialog. */
export interface InvitationSummaryDto {
  eventName: string;
  /** Guests that will actually receive an e-mail. */
  recipients: number;
  /** Tickets those e-mails will carry (existing valid ones plus those about to be generated). */
  tickets: number;
  ticketsToGenerate: number;
  skippedAlreadySent: number;
  skippedNoTickets: number;
}

export interface InvitationPreviewDto {
  subject: string;
  html: string;
  to: string;
}

export interface MailboxMessageDto {
  id: string;
  to: string;
  subject: string;
  createdAt: string;
}

// ── Check-in / scanner ──────────────────────────────────────────────────────

export interface CheckInResponse {
  result: ScanResult;
  /** Serbian headline, e.g. "ULAZ DOZVOLJEN". */
  title: string;
  scannedAt: string;
  ticket: {
    reference: string;
    guestName: string;
    ticketType: TicketTypeRef & { instructions: string | null };
    /** When the ticket was (first) used. */
    usedAt: string | null;
  } | null;
}

export interface ScannerEventDto {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  venueName: string;
  status: EventStatus;
  organizerName: string;
}

export interface ScannerSearchResultDto {
  ticketId: string;
  reference: string;
  guestName: string;
  ticketType: TicketTypeRef;
  status: TicketStatus;
  usedAt: string | null;
}

export interface ScanLogDto {
  id: string;
  result: ScanResult;
  method: ScanMethod;
  createdAt: string;
  eventId: string;
  eventName: string;
  reference: string | null;
  guestName: string | null;
  ticketType: TicketTypeRef | null;
  scannerName: string;
}

// ── Analytics ───────────────────────────────────────────────────────────────

export interface EventStatsDto {
  eventId: string;
  generatedAt: string;
  capacity: number | null;
  guests: {
    total: number;
    /** Guests with at least one checked-in ticket. */
    checkedIn: number;
  };
  tickets: {
    /** Allocated by the organizer (may not all be generated yet). */
    allocated: number;
    generated: number;
    valid: number;
    used: number;
    revoked: number;
  };
  invitations: Record<GuestEmailStatus, number>;
  /** used / (valid + used), 0–100. */
  checkInRate: number;
  ticketTypes: {
    id: string;
    name: string;
    color: string;
    valid: number;
    used: number;
    revoked: number;
  }[];
  /** Check-ins grouped in 15-minute buckets, with the running total. */
  checkInsOverTime: { time: string; count: number; cumulative: number }[];
  recentCheckIns: {
    id: string;
    guestName: string;
    reference: string;
    ticketType: TicketTypeRef;
    usedAt: string;
    scannerName: string | null;
  }[];
  scanResults: Partial<Record<ScanResult, number>>;
}

export interface DashboardDto {
  totals: {
    events: number;
    activeEvents: number;
    guests: number;
    tickets: number;
    checkedIn: number;
    invitationsSent: number;
    organizers?: number;
    users?: number;
  };
  upcoming: EventDto[];
  recent: EventDto[];
  recentCheckIns: {
    id: string;
    eventId: string;
    eventName: string;
    guestName: string;
    ticketType: TicketTypeRef;
    usedAt: string;
  }[];
}

// ── Public ticket page ──────────────────────────────────────────────────────

export interface PublicTicketDto {
  reference: string;
  status: TicketStatus;
  expired: boolean;
  usedAt: string | null;
  guestName: string;
  ticketType: { name: string; color: string; instructions: string | null };
  event: {
    name: string;
    startsAt: string;
    endsAt: string | null;
    venueName: string;
    venueAddress: string | null;
    coverImageUrl: string | null;
    status: EventStatus;
    organizerName: string;
    organizerLogoUrl: string | null;
  };
  /** Inline SVG markup of the QR code (generated server-side). */
  qrSvg: string;
  /**
   * The same code as a PNG data URL with its own white background and quiet
   * zone. Preferred for display: forced dark mode repaints SVG fills and CSS
   * backgrounds but leaves bitmaps alone. Optional only so a newer web build
   * keeps working against an older API.
   */
  qrPng?: string;
}
