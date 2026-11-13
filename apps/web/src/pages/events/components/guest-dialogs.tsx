import {
  addGuestSchema,
  emailSchema,
  MAX_TICKETS_PER_GUEST,
  type BulkGuestsResult,
  type EventDto,
  type GuestInput,
  type GuestMutationResult,
  type GuestRowDto,
  type ImportResultDto,
  type TicketTypeDto,
} from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, Upload } from 'lucide-react';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Badge, TicketTypeTag } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/controls';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { api, errorMessage, qs } from '@/lib/api';
import { formatNumber, plural } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { uuid } from '@/lib/utils';
import { eventKeys } from '../event-queries';
import { describeSendResult } from './invitation-dialogs';

type GuestFormValues = z.input<typeof addGuestSchema>;

interface TicketTypeSelectProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  ticketTypes: TicketTypeDto[];
  invalid?: boolean;
}

export function TicketTypeSelect({ id, value, onChange, ticketTypes, invalid }: TicketTypeSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} aria-invalid={invalid}>
        <SelectValue placeholder="Izaberi tip karte" />
      </SelectTrigger>
      <SelectContent>
        {ticketTypes.map((type) => (
          <SelectItem key={type.id} value={type.id}>
            <TicketTypeTag name={type.name} color={type.color} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface GuestFormDialogProps {
  event: EventDto;
  ticketTypes: TicketTypeDto[];
  /** When set, the dialog edits this guest instead of adding a new one. */
  guest?: GuestRowDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Add / edit one guest. In "add" mode it doubles as the single-invitation
 * flow: name, e-mail, ticket type, quantity → "Pošalji pozivnicu".
 */
export function GuestFormDialog({ event, ticketTypes, guest, open, onOpenChange }: GuestFormDialogProps) {
  const queryClient = useQueryClient();
  const editing = Boolean(guest);
  const canSend = event.status === 'ACTIVE';

  const defaults = React.useCallback(
    (): GuestFormValues => ({
      firstName: guest?.firstName ?? '',
      lastName: guest?.lastName ?? '',
      email: guest?.email ?? '',
      phone: guest?.phone ?? '',
      notes: guest?.notes ?? '',
      ticketTypeId: guest?.ticketType.id ?? ticketTypes[0]?.id ?? '',
      ticketQuantity: guest?.ticketQuantity ?? 1,
      generateTickets: false,
      sendInvitation: !guest && canSend,
    }),
    [guest, ticketTypes, canSend],
  );

  const form = useForm<GuestFormValues>({ resolver: zodResolver(addGuestSchema), defaultValues: defaults() });
  const { errors, isSubmitting } = form.formState;
  const sendNow = form.watch('sendInvitation');
  const requestId = React.useMemo(() => (open ? uuid() : ''), [open]);

  React.useEffect(() => {
    if (open) form.reset(defaults());
  }, [open, defaults, form]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (guest) {
        const { generateTickets: _g, sendInvitation: _s, requestId: _r, ...patch } = values;
        await api.patch<GuestRowDto>(`/events/${event.id}/guests/${guest.id}`, patch);
        toast.success('Podaci o gostu su sačuvani.');
      } else {
        const result = await api.post<GuestMutationResult>(`/events/${event.id}/guests`, { ...values, requestId });
        if (values.sendInvitation) {
          toast.success(result.invitationQueued ? 'Pozivnica je u redu za slanje.' : 'Gost je dodat, ali pozivnica nije poslata.', {
            description: `${result.guest.firstName} ${result.guest.lastName} · ${formatNumber(result.ticketsGenerated)} ${plural(result.ticketsGenerated, 'karta', 'karte', 'karata')}`,
          });
        } else {
          toast.success('Gost je dodat na listu.');
        }
      }
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={editing ? 'Izmena gosta' : 'Novi gost'} description={editing ? undefined : `Dodaj gosta na listu događaja ${event.name}.`} />
          <DialogBody className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Ime" htmlFor="guest-firstName" error={errors.firstName?.message}>
                <Input id="guest-firstName" autoComplete="off" autoFocus={!editing} aria-invalid={!!errors.firstName} {...form.register('firstName')} />
              </Field>
              <Field label="Prezime" htmlFor="guest-lastName" optional error={errors.lastName?.message}>
                <Input id="guest-lastName" autoComplete="off" aria-invalid={!!errors.lastName} {...form.register('lastName')} />
              </Field>
            </div>
            <Field label="Email adresa" htmlFor="guest-email" error={errors.email?.message}>
              <Input id="guest-email" type="email" inputMode="email" autoComplete="off" aria-invalid={!!errors.email} {...form.register('email')} />
            </Field>
            <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
              <Field label="Tip karte" htmlFor="guest-ticketType" error={errors.ticketTypeId?.message}>
                <Controller
                  control={form.control}
                  name="ticketTypeId"
                  render={({ field }) => (
                    <TicketTypeSelect id="guest-ticketType" value={field.value} onChange={field.onChange} ticketTypes={ticketTypes} invalid={!!errors.ticketTypeId} />
                  )}
                />
              </Field>
              <Field label="Broj karata" htmlFor="guest-quantity" error={errors.ticketQuantity?.message}>
                <Input
                  id="guest-quantity"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_TICKETS_PER_GUEST}
                  aria-invalid={!!errors.ticketQuantity}
                  {...form.register('ticketQuantity')}
                />
              </Field>
            </div>
            <Field label="Telefon" htmlFor="guest-phone" optional error={errors.phone?.message}>
              <Input id="guest-phone" type="tel" autoComplete="off" aria-invalid={!!errors.phone} {...form.register('phone')} />
            </Field>
            <Field label="Napomena" htmlFor="guest-notes" optional hint="Vidiš je samo ti — gost je ne dobija." error={errors.notes?.message}>
              <Textarea id="guest-notes" rows={2} aria-invalid={!!errors.notes} {...form.register('notes')} />
            </Field>

            {!editing && (
              <Controller
                control={form.control}
                name="sendInvitation"
                render={({ field }) => (
                  <label className={`flex items-start gap-3 rounded-md border border-line p-4 ${canSend ? '' : 'opacity-60'}`}>
                    <Checkbox checked={canSend && !!field.value} onCheckedChange={(v) => field.onChange(v === true)} disabled={!canSend} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">Odmah generiši karte i pošalji pozivnicu</span>
                      <span className="mt-0.5 block text-[13px] text-ink-muted">
                        {canSend ? 'Gost dobija email sa svojim QR ulaznicama.' : 'Dostupno kada je događaj aktivan.'}
                      </span>
                    </span>
                  </label>
                )}
              />
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Odustani
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {editing ? 'Sačuvaj izmene' : sendNow && canSend ? 'Pošalji pozivnicu' : 'Dodaj gosta'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Add several guests by pasting lines ─────────────────────────────────────

interface ParsedLine {
  line: number;
  raw: string;
  guest?: Pick<GuestInput, 'firstName' | 'lastName' | 'email'>;
  error?: string;
}

/** Accepts "Ime Prezime, email", "Ime Prezime <email>", "email" or tab/semicolon separated values. */
export function parseGuestLines(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), line: index + 1 }))
    .filter((l) => l.raw !== '')
    .map(({ raw, line }) => {
      const emailMatch = /[^\s,;<>()"]+@[^\s,;<>()"]+/.exec(raw);
      if (!emailMatch) return { line, raw, error: 'Nedostaje email adresa.' };
      const email = emailSchema.safeParse(emailMatch[0]);
      if (!email.success) return { line, raw, error: 'Neispravna email adresa.' };
      const name = raw.replace(emailMatch[0], ' ').replace(/[<>,;()"\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      const [first, ...rest] = name.split(' ');
      // No name given → use the part before "@" so the greeting is never empty.
      const firstName = (first || email.data.split('@')[0]).slice(0, 60);
      return { line, raw, guest: { firstName, lastName: rest.join(' ').slice(0, 60), email: email.data } };
    });
}

interface BulkAddDialogProps {
  event: EventDto;
  ticketTypes: TicketTypeDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BulkAddDialog({ event, ticketTypes, open, onOpenChange }: BulkAddDialogProps) {
  const queryClient = useQueryClient();
  const [text, setText] = React.useState('');
  const [ticketTypeId, setTicketTypeId] = React.useState('');
  const [quantity, setQuantity] = React.useState('1');

  React.useEffect(() => {
    if (open) {
      setText('');
      setQuantity('1');
      setTicketTypeId(ticketTypes[0]?.id ?? '');
    }
  }, [open, ticketTypes]);

  const parsed = React.useMemo(() => parseGuestLines(text), [text]);
  const valid = parsed.filter((p) => p.guest);
  const invalid = parsed.filter((p) => p.error);
  const qty = Number(quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= MAX_TICKETS_PER_GUEST;

  const add = useMutation({
    mutationFn: () =>
      api.post<BulkGuestsResult>(`/events/${event.id}/guests/bulk`, {
        guests: valid.map((p) => ({ ...p.guest, ticketTypeId, ticketQuantity: qty })),
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });
      const skipped = result.skippedExisting.length + result.duplicatesInBatch.length;
      toast.success(`${formatNumber(result.created)} ${plural(result.created, 'gost je dodat', 'gosta su dodata', 'gostiju je dodato')}`, {
        description: skipped > 0 ? `${formatNumber(skipped)} preskočeno — adresa je već na listi ili se ponavlja.` : undefined,
      });
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !add.isPending && onOpenChange(next)}>
      <DialogContent size="lg">
        <DialogHeader title="Dodavanje više gostiju" description="Unesi po jednog gosta u svakom redu: ime i prezime, pa email adresa." />
        <DialogBody className="space-y-5">
          <Field label="Gosti" htmlFor="bulk-text" hint={'Primer: „Marko Petrović, marko@example.com". Može i samo email adresa.'}>
            <Textarea
              id="bulk-text"
              rows={8}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Marko Petrović, marko@example.com\nJelena Jovanović, jelena@example.com'}
              className="font-mono text-[13px]"
              autoFocus
            />
          </Field>
          <div className="grid gap-5 sm:grid-cols-[1fr_8rem]">
            <Field label="Tip karte za sve" htmlFor="bulk-type">
              <TicketTypeSelect id="bulk-type" value={ticketTypeId} onChange={setTicketTypeId} ticketTypes={ticketTypes} />
            </Field>
            <Field label="Karata po gostu" htmlFor="bulk-qty" error={qtyOk ? undefined : `Od 1 do ${MAX_TICKETS_PER_GUEST}.`}>
              <Input id="bulk-qty" type="number" min={1} max={MAX_TICKETS_PER_GUEST} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!qtyOk} />
            </Field>
          </div>
          {parsed.length > 0 && (
            <div role="status" className="rounded-md border border-line bg-subtle/60 px-4 py-3 text-sm">
              <span className="font-semibold">
                Prepoznato: {formatNumber(valid.length)} {plural(valid.length, 'gost', 'gosta', 'gostiju')}
              </span>
              {invalid.length > 0 && (
                <ul className="mt-2 space-y-1 text-[13px] text-danger">
                  {invalid.slice(0, 5).map((p) => (
                    <li key={p.line}>
                      Red {p.line}: {p.error} <span className="text-ink-muted">({p.raw.slice(0, 40)})</span>
                    </li>
                  ))}
                  {invalid.length > 5 && <li>… i još {invalid.length - 5}.</li>}
                </ul>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={add.isPending}>
            Odustani
          </Button>
          <Button onClick={() => add.mutate()} loading={add.isPending} disabled={valid.length === 0 || !ticketTypeId || !qtyOk || valid.length > 500}>
            Dodaj {valid.length > 0 ? formatNumber(valid.length) : ''} {plural(valid.length, 'gosta', 'gosta', 'gostiju')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV / Excel import ──────────────────────────────────────────────────────

const IMPORT_STATUS: Record<ImportResultDto['rows'][number]['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }> = {
  OK: { label: 'Spreman', tone: 'success' },
  DUPLICATE_IN_FILE: { label: 'Duplikat u fajlu', tone: 'warning' },
  ALREADY_ON_EVENT: { label: 'Već na listi', tone: 'muted' },
  INVALID: { label: 'Greška', tone: 'danger' },
};

interface ImportDialogProps {
  event: EventDto;
  ticketTypes: TicketTypeDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Two steps: upload → server-side dry run with per-row validation → confirm. */
export function ImportDialog({ event, ticketTypes, open, onOpenChange }: ImportDialogProps) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [ticketTypeId, setTicketTypeId] = React.useState('');
  const [preview, setPreview] = React.useState<ImportResultDto | null>(null);

  React.useEffect(() => {
    if (open) {
      setFile(null);
      setPreview(null);
      setTicketTypeId(ticketTypes[0]?.id ?? '');
    }
  }, [open, ticketTypes]);

  const upload = (dryRun: boolean) => {
    const form = new FormData();
    form.append('file', file as File);
    return api.upload<ImportResultDto>(`/events/${event.id}/guests/import${qs({ dryRun, defaultTicketTypeId: ticketTypeId })}`, form);
  };

  const check = useMutation({
    mutationFn: () => upload(true),
    onSuccess: setPreview,
    onError: (err) => toast.error(errorMessage(err)),
  });

  const commit = useMutation({
    mutationFn: () => upload(false),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });
      toast.success(`Uvezeno: ${formatNumber(result.created)} ${plural(result.created, 'gost', 'gosta', 'gostiju')}`);
      onOpenChange(false);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const busy = check.isPending || commit.isPending;
  const problems = preview ? preview.rows.filter((r) => r.status !== 'OK') : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="xl">
        <DialogHeader
          title="Uvoz gostiju iz fajla"
          description="CSV ili Excel (.xlsx) fajl sa zaglavljem. Prepoznajemo kolone: Ime, Prezime, Email, Telefon, Napomena, Tip karte, Broj karata."
        />
        <DialogBody className="space-y-5">
          {!preview ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                aria-label="Fajl sa gostima"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="flex w-full flex-col items-center rounded-lg border border-dashed border-line-strong bg-subtle/40 px-6 py-10 text-center transition-colors hover:border-ink-faint hover:bg-subtle"
              >
                <FileSpreadsheet className="size-7 text-ink-muted" strokeWidth={1.5} aria-hidden />
                <span className="mt-3 text-sm font-semibold">{file ? file.name : 'Izaberi fajl'}</span>
                <span className="mt-1 text-[13px] text-ink-muted">
                  {file ? `${Math.max(1, Math.round(file.size / 1024))} KB · klikni da izabereš drugi` : 'CSV ili XLSX, najviše 2 MB i 5.000 redova'}
                </span>
              </button>
              <Field label="Tip karte za redove bez navedenog tipa" htmlFor="import-type">
                <TicketTypeSelect id="import-type" value={ticketTypeId} onChange={setTicketTypeId} ticketTypes={ticketTypes} />
              </Field>
            </>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line text-center">
                {[
                  ['Redova u fajlu', preview.totalRows],
                  ['Spremno za uvoz', preview.validRows],
                  ['Preskače se', preview.totalRows - preview.validRows],
                ].map(([label, value]) => (
                  <div key={label} className="bg-surface px-3 py-3">
                    <div className="tabular text-xl font-bold">{formatNumber(value as number)}</div>
                    <div className="text-xs text-ink-muted">{label}</div>
                  </div>
                ))}
              </div>
              {problems.length > 0 ? (
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Redovi koji se preskaču</h3>
                  <TableFrame>
                    <Table>
                      <thead>
                        <tr>
                          <Th className="w-16">Red</Th>
                          <Th>Gost</Th>
                          <Th className="hidden sm:table-cell">Email</Th>
                          <Th>Razlog</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {problems.slice(0, 100).map((row) => (
                          <Tr key={row.row}>
                            <Td className="tabular text-ink-muted">{row.row}</Td>
                            <Td className="font-medium">{`${row.firstName} ${row.lastName}`.trim() || '—'}</Td>
                            <Td className="hidden text-ink-muted sm:table-cell">{row.email || '—'}</Td>
                            <Td>
                              <Badge tone={IMPORT_STATUS[row.status].tone}>{IMPORT_STATUS[row.status].label}</Badge>
                              <div className="mt-1 text-[13px] text-ink-muted">{row.error}</div>
                            </Td>
                          </Tr>
                        ))}
                      </tbody>
                    </Table>
                  </TableFrame>
                  {problems.length > 100 && <p className="mt-2 text-[13px] text-ink-muted">Prikazano prvih 100 od {formatNumber(problems.length)}.</p>}
                </div>
              ) : (
                <p className="rounded-md border border-success/25 bg-success-soft px-4 py-3 text-sm font-medium text-success">Svi redovi su ispravni.</p>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {preview ? (
            <>
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
                Izaberi drugi fajl
              </Button>
              <Button onClick={() => commit.mutate()} loading={commit.isPending} disabled={preview.validRows === 0}>
                <Upload /> Uvezi {formatNumber(preview.validRows)} {plural(preview.validRows, 'gosta', 'gosta', 'gostiju')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
                Odustani
              </Button>
              <Button onClick={() => check.mutate()} loading={check.isPending} disabled={!file || !ticketTypeId}>
                Proveri fajl
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { describeSendResult };
