import { z } from 'zod';
import { EVENT_STATUSES, USER_ROLES } from './enums';

// Validation schemas used by BOTH sides: React Hook Form on the client and
// the ZodValidationPipe on the API. Messages are user-facing → Serbian.

const requiredText = (label: string, max = 120) =>
  z
    .string({ required_error: `${label} je obavezno polje.` })
    .trim()
    .min(1, `${label} je obavezno polje.`)
    .max(max, `${label} može imati najviše ${max} znakova.`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Najviše ${max} znakova.`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const emailSchema = z
  .string({ required_error: 'Email adresa je obavezna.' })
  .trim()
  .toLowerCase()
  .min(1, 'Email adresa je obavezna.')
  .max(254, 'Email adresa je predugačka.')
  .email('Unesi ispravnu email adresu.');

export const passwordSchema = z
  .string({ required_error: 'Lozinka je obavezna.' })
  .min(10, 'Lozinka mora imati najmanje 10 znakova.')
  .max(128, 'Lozinka može imati najviše 128 znakova.')
  .refine((v) => /[A-Za-zčćšžđČĆŠŽĐ]/.test(v) && /\d/.test(v), 'Lozinka mora sadržati bar jedno slovo i jednu cifru.');

const uuid = z.string().uuid('Neispravan identifikator.');

// ── Auth ────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'Lozinka je obavezna.' }).min(1, 'Lozinka je obavezna.').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
});
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Unesi trenutnu lozinku.').max(128),
  newPassword: passwordSchema,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const updateProfileSchema = z.object({
  firstName: requiredText('Ime', 60),
  lastName: requiredText('Prezime', 60),
});
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// ── Organizers & users ──────────────────────────────────────────────────────

export const organizerInputSchema = z.object({
  name: requiredText('Naziv', 120),
  contactEmail: z.union([emailSchema, z.literal('')]).optional().nullable().transform((v) => (v ? v : null)),
  retentionDays: z.coerce
    .number({ invalid_type_error: 'Unesi broj dana.' })
    .int('Unesi ceo broj.')
    .min(0, 'Vrednost ne može biti negativna.')
    .max(3650, 'Najviše 3650 dana.'),
});
export type OrganizerInput = z.infer<typeof organizerInputSchema>;

export const userCreateSchema = z.object({
  firstName: requiredText('Ime', 60),
  lastName: requiredText('Prezime', 60),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES),
  organizerId: uuid.optional().nullable(),
});
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const userUpdateSchema = z.object({
  firstName: requiredText('Ime', 60).optional(),
  lastName: requiredText('Prezime', 60).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
});
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;

export const staffCreateSchema = z.object({
  organizerId: uuid.optional(),
  firstName: requiredText('Ime', 60),
  lastName: requiredText('Prezime', 60),
  email: emailSchema,
  password: passwordSchema,
  eventIds: z.array(uuid).max(200).default([]),
});
export type StaffCreateInput = z.infer<typeof staffCreateSchema>;

export const staffUpdateSchema = z.object({
  firstName: requiredText('Ime', 60).optional(),
  lastName: requiredText('Prezime', 60).optional(),
  isActive: z.boolean().optional(),
  password: passwordSchema.optional(),
  eventIds: z.array(uuid).max(200).optional(),
});
export type StaffUpdateInput = z.infer<typeof staffUpdateSchema>;

export const eventStaffSchema = z.object({ userIds: z.array(uuid).max(200) });
export type EventStaffInput = z.infer<typeof eventStaffSchema>;

// ── Events ──────────────────────────────────────────────────────────────────

const isoDate = z.string().datetime({ offset: true, message: 'Neispravan datum.' });

const eventBase = z.object({
  organizerId: uuid.optional(),
  name: requiredText('Naziv događaja', 120),
  description: optionalText(5000),
  startsAt: isoDate,
  endsAt: isoDate.optional().nullable().transform((v) => v ?? null),
  venueName: requiredText('Naziv lokacije', 120),
  venueAddress: optionalText(240),
  capacity: z
    .union([z.coerce.number().int('Unesi ceo broj.').min(1, 'Kapacitet mora biti najmanje 1.').max(1_000_000), z.null()])
    .optional()
    .transform((v) => v ?? null),
  enforceCapacity: z.boolean().default(false),
  status: z.enum(EVENT_STATUSES).default('DRAFT'),
});

const endsAfterStart = (v: { startsAt?: string; endsAt?: string | null }) =>
  !v.endsAt || !v.startsAt || new Date(v.endsAt).getTime() > new Date(v.startsAt).getTime();

export const eventInputSchema = eventBase.refine(endsAfterStart, {
  message: 'Kraj događaja mora biti posle početka.',
  path: ['endsAt'],
});
export type EventInput = z.infer<typeof eventInputSchema>;

export const eventUpdateSchema = eventBase
  .omit({ organizerId: true })
  .partial()
  .refine(endsAfterStart, { message: 'Kraj događaja mora biti posle početka.', path: ['endsAt'] });
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>;

// ── Ticket types ────────────────────────────────────────────────────────────

export const ticketTypeInputSchema = z.object({
  name: requiredText('Naziv', 60),
  description: optionalText(500),
  capacity: z
    .union([z.coerce.number().int('Unesi ceo broj.').min(1, 'Najmanje 1.').max(1_000_000), z.null()])
    .optional()
    .transform((v) => v ?? null),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Izaberi boju.').default('#64748B'),
  instructions: optionalText(500),
});
export type TicketTypeInput = z.infer<typeof ticketTypeInputSchema>;

// ── Guests ──────────────────────────────────────────────────────────────────

export const MAX_TICKETS_PER_GUEST = 20;

export const guestInputSchema = z.object({
  firstName: requiredText('Ime', 60),
  lastName: z.string().trim().max(60, 'Prezime može imati najviše 60 znakova.').default(''),
  email: emailSchema,
  phone: optionalText(40),
  notes: optionalText(1000),
  ticketTypeId: uuid,
  ticketQuantity: z.coerce
    .number({ invalid_type_error: 'Unesi broj karata.' })
    .int('Unesi ceo broj.')
    .min(1, 'Najmanje jedna karta.')
    .max(MAX_TICKETS_PER_GUEST, `Najviše ${MAX_TICKETS_PER_GUEST} karata po gostu.`)
    .default(1),
});
export type GuestInput = z.infer<typeof guestInputSchema>;

export const addGuestSchema = guestInputSchema.extend({
  generateTickets: z.boolean().default(false),
  sendInvitation: z.boolean().default(false),
  requestId: uuid.optional(),
});
export type AddGuestInput = z.infer<typeof addGuestSchema>;

export const bulkGuestsSchema = z.object({
  guests: z.array(guestInputSchema).min(1, 'Dodaj bar jednog gosta.').max(500, 'Najviše 500 gostiju odjednom.'),
});
export type BulkGuestsInput = z.infer<typeof bulkGuestsSchema>;

export const updateGuestSchema = guestInputSchema.partial();
export type UpdateGuestInput = z.infer<typeof updateGuestSchema>;

export const eventGuestIdsSchema = z.object({
  eventGuestIds: z.array(uuid).min(1, 'Izaberi bar jednog gosta.').max(5000),
});
export type EventGuestIdsInput = z.infer<typeof eventGuestIdsSchema>;

export const exportGuestsSchema = z.object({
  eventGuestIds: z.array(uuid).max(5000).optional(),
});

// ── Tickets ─────────────────────────────────────────────────────────────────

export const revokeTicketsSchema = z
  .object({
    ticketIds: z.array(uuid).max(5000).optional(),
    eventGuestIds: z.array(uuid).max(5000).optional(),
  })
  .refine((v) => (v.ticketIds?.length ?? 0) + (v.eventGuestIds?.length ?? 0) > 0, {
    message: 'Izaberi bar jednu kartu.',
  });
export type RevokeTicketsInput = z.infer<typeof revokeTicketsSchema>;

export const ticketUpdateSchema = z.object({
  /** Optional moment after which the ticket is no longer accepted at the door. */
  expiresAt: isoDate.nullable(),
});
export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>;

// ── Invitations ─────────────────────────────────────────────────────────────

export const sendInvitationsSchema = z.object({
  eventGuestIds: z.array(uuid).min(1, 'Izaberi bar jednog gosta.').max(5000),
  /** Client-generated id of this "send" click. Makes HTTP retries idempotent. */
  requestId: uuid,
  /** SEND skips guests that already have an invitation; RESEND sends again. */
  mode: z.enum(['SEND', 'RESEND']).default('SEND'),
});
export type SendInvitationsInput = z.infer<typeof sendInvitationsSchema>;

export const invitationSummarySchema = z.object({
  eventGuestIds: z.array(uuid).min(1, 'Izaberi bar jednog gosta.').max(5000),
  mode: z.enum(['SEND', 'RESEND']).default('SEND'),
});
export type InvitationSummaryInput = z.infer<typeof invitationSummarySchema>;

export const previewInvitationSchema = z.object({
  eventGuestId: uuid.optional(),
});

// ── Check-in ────────────────────────────────────────────────────────────────

export const checkInSchema = z
  .object({
    /** Raw token extracted from the QR code. */
    token: z.string().min(1).max(512).optional(),
    /** Manual check-in of a ticket found through search. */
    ticketId: uuid.optional(),
  })
  .refine((v) => Boolean(v.token) !== Boolean(v.ticketId), { message: 'Pošalji token ili ID karte.' });
export type CheckInInput = z.infer<typeof checkInSchema>;
