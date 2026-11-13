import type {
  EventStatus,
  GuestEmailStatus,
  GuestTicketState,
  ScanMethod,
  ScanResult,
  TicketStatus,
  UserRole,
} from './enums';

// All user-facing copy is Serbian (Latin). Keeping the labels here guarantees
// the API (e-mails, scan responses) and the UI use identical wording.

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Administrator platforme',
  ORGANIZER: 'Organizator',
  SCANNER: 'Osoblje na ulazu',
};

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  DRAFT: 'Nacrt',
  ACTIVE: 'Aktivan',
  COMPLETED: 'Završen',
  CANCELLED: 'Otkazan',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  VALID: 'Važeća',
  USED: 'Iskorišćena',
  REVOKED: 'Poništena',
};

export const GUEST_TICKET_STATE_LABELS: Record<GuestTicketState, string> = {
  NONE: 'Nema karte',
  VALID: 'Važeća',
  PARTIALLY_USED: 'Delimično iskorišćena',
  USED: 'Iskorišćena',
  REVOKED: 'Poništena',
};

export const EMAIL_STATUS_LABELS: Record<GuestEmailStatus, string> = {
  NOT_SENT: 'Nije poslato',
  QUEUED: 'U redu za slanje',
  SENDING: 'Slanje u toku',
  SENT: 'Poslato',
  DELIVERED: 'Isporuka potvrđena',
  BOUNCED: 'Greška pri slanju',
  FAILED: 'Greška pri slanju',
};

/** Longer explanation shown in tooltips / detail views. */
export const EMAIL_STATUS_HINTS: Record<GuestEmailStatus, string> = {
  NOT_SENT: 'Pozivnica još nije poslata.',
  QUEUED: 'Pozivnica čeka na slanje.',
  SENDING: 'Pozivnica se upravo šalje.',
  SENT: 'Servis za slanje je prihvatio poruku. Isporuka još nije potvrđena.',
  DELIVERED: 'Server primaoca je potvrdio prijem poruke.',
  BOUNCED: 'Server primaoca je odbio poruku. Proveri adresu.',
  FAILED: 'Slanje nije uspelo ni posle više pokušaja.',
};

export const SCAN_RESULT_TITLES: Record<ScanResult, string> = {
  ADMITTED: 'ULAZ DOZVOLJEN',
  ALREADY_USED: 'KARTA JE VEĆ ISKORIŠĆENA',
  REVOKED: 'KARTA JE PONIŠTENA',
  WRONG_EVENT: 'KARTA NIJE ZA OVAJ DOGAĐAJ',
  INVALID: 'NEVAŽEĆA KARTA',
  EXPIRED: 'KARTA JE ISTEKLA',
  EVENT_NOT_ACTIVE: 'DOGAĐAJ NIJE AKTIVAN',
  EVENT_ENDED: 'DOGAĐAJ JE ZAVRŠEN',
  CAPACITY_REACHED: 'KAPACITET JE POPUNJEN',
};

/** Short labels for tables / history lists. */
export const SCAN_RESULT_LABELS: Record<ScanResult, string> = {
  ADMITTED: 'Ulaz dozvoljen',
  ALREADY_USED: 'Već iskorišćena',
  REVOKED: 'Poništena',
  WRONG_EVENT: 'Pogrešan događaj',
  INVALID: 'Nevažeća',
  EXPIRED: 'Istekla',
  EVENT_NOT_ACTIVE: 'Događaj nije aktivan',
  EVENT_ENDED: 'Događaj završen',
  CAPACITY_REACHED: 'Kapacitet popunjen',
};

export const SCAN_METHOD_LABELS: Record<ScanMethod, string> = {
  QR: 'QR kod',
  MANUAL: 'Ručno',
};

export const NETWORK_ERROR_TITLE = 'PROVERA NIJE USPELA — PROVERI INTERNET KONEKCIJU';
