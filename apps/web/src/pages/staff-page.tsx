import {
  passwordSchema,
  staffCreateSchema,
  staffUpdateSchema,
  type EventDto,
  type OrganizerDto,
  type StaffCreateInput,
  type StaffDto,
  type StaffUpdateInput,
} from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Plus, ScanLine, UserCheck, UserX } from 'lucide-react';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUser } from '@/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Skeleton } from '@/components/ui/controls';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, Label } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states';
import { Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateShort, formatRelative } from '@/lib/format';

const STAFF_KEY = ['staff'] as const;
const EVENTS_KEY = ['events', { archived: false }] as const;
const ORGANIZERS_KEY = ['organizers'] as const;

const PASSWORD_HINT = 'Najmanje 10 znakova, bar jedno slovo i jedna cifra.';

const passwordResetSchema = z.object({ password: passwordSchema });
type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/** Puts server-side field errors on the form; anything else becomes a toast. */
function applyFormError<T extends FieldValues>(err: unknown, form: UseFormReturn<T>, fields: readonly Path<T>[]): void {
  if (err instanceof ApiError && err.fieldErrors) {
    let mapped = false;
    for (const field of fields) {
      const message = err.fieldErrors[field];
      if (message) {
        form.setError(field, { message });
        mapped = true;
      }
    }
    if (mapped) return;
  }
  toast.error(errorMessage(err));
}

const fullName = (person: { firstName: string; lastName: string }) => `${person.firstName} ${person.lastName}`.trim();

function useEvents() {
  return useQuery({ queryKey: EVENTS_KEY, queryFn: () => api.get<EventDto[]>('/events') });
}

export function StaffPage() {
  const user = useUser();
  const queryClient = useQueryClient();
  const showOrganizer = user.role === 'SUPER_ADMIN' || user.organizers.length > 1;

  const staff = useQuery({ queryKey: STAFF_KEY, queryFn: () => api.get<StaffDto[]>('/staff') });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<StaffDto | null>(null);
  const [resetting, setResetting] = React.useState<StaffDto | null>(null);
  const [deactivating, setDeactivating] = React.useState<StaffDto | null>(null);

  const setActive = useMutation({
    mutationFn: ({ member, isActive }: { member: StaffDto; isActive: boolean }) =>
      api.patch<StaffDto>(`/staff/${member.id}`, { isActive } satisfies StaffUpdateInput),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.success(result.isActive ? `${fullName(result)} ponovo ima pristup skeneru.` : `${fullName(result)} više nema pristup skeneru.`);
      setDeactivating(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const addButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus aria-hidden /> Dodaj člana osoblja
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Osoblje na ulazu"
        description="Osoblje može da skenira karte samo za događaje koji su mu dodeljeni i nikada ne vidi spisak gostiju."
        actions={addButton}
      />

      {staff.isPending ? (
        <TableSkeleton rows={5} />
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={() => void staff.refetch()} />
      ) : staff.data.length === 0 ? (
        <EmptyState
          icon={ScanLine}
          title="Još nema osoblja na ulazu"
          description="Dodaj osobe koje će skenirati karte na ulazu i dodeli im događaje na kojima rade."
          action={addButton}
        />
      ) : (
        <TableFrame>
          <Table>
            <thead>
              <tr>
                <Th>Ime</Th>
                {showOrganizer && <Th className="hidden lg:table-cell">Organizator</Th>}
                <Th className="hidden sm:table-cell">Dodeljeni događaji</Th>
                <Th className="hidden md:table-cell">Poslednja prijava</Th>
                <Th>Status</Th>
                <Th className="w-12">
                  <span className="sr-only">Akcije</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {staff.data.map((member) => (
                <Tr key={member.id}>
                  <Td>
                    <div className="font-semibold text-ink">{fullName(member)}</div>
                    <div className="text-[13px] text-ink-muted">{member.email}</div>
                  </Td>
                  {showOrganizer && <Td className="hidden text-ink-muted lg:table-cell">{member.organizerName || '—'}</Td>}
                  <Td className="hidden max-w-xs sm:table-cell">
                    {member.events.length > 0 ? (
                      member.events.map((event) => event.name).join(', ')
                    ) : (
                      <span className="text-ink-faint">Nema dodeljenih događaja</span>
                    )}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-ink-muted md:table-cell">
                    {member.lastLoginAt ? formatRelative(member.lastLoginAt) : 'Nikad'}
                  </Td>
                  <Td>
                    <Badge tone={member.isActive ? 'success' : 'muted'}>{member.isActive ? 'Aktivan' : 'Deaktiviran'}</Badge>
                  </Td>
                  <Td className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label={`Akcije za: ${fullName(member)}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setEditing(member)}>
                          <Pencil aria-hidden /> Izmeni
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResetting(member)}>
                          <KeyRound aria-hidden /> Postavi novu lozinku
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {member.isActive ? (
                          <DropdownMenuItem destructive onSelect={() => setDeactivating(member)}>
                            <UserX aria-hidden /> Deaktiviraj
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem disabled={setActive.isPending} onSelect={() => setActive.mutate({ member, isActive: true })}>
                            <UserCheck aria-hidden /> Aktiviraj
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <CreateStaffForm showOrganizer={showOrganizer} onDone={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>{editing && <EditStaffForm member={editing} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent size="sm">{resetting && <ResetPasswordForm member={resetting} onDone={() => setResetting(null)} />}</DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => !open && setDeactivating(null)}
        title="Deaktiviraj člana osoblja?"
        description={
          <>
            <strong className="font-semibold text-ink">{deactivating ? fullName(deactivating) : ''}</strong> odmah gubi pristup skeneru i biće odjavljen
            sa svih uređaja. Nalog možeš ponovo da aktiviraš u svakom trenutku.
          </>
        }
        confirmLabel="Deaktiviraj"
        loading={setActive.isPending}
        onConfirm={() => deactivating && setActive.mutate({ member: deactivating, isActive: false })}
      />
    </div>
  );
}

// ── Event assignment ────────────────────────────────────────────────────────

interface EventChecklistProps {
  idPrefix: string;
  events: EventDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  value: string[];
  onChange: (value: string[]) => void;
  emptyText: string;
}

function EventChecklist({ idPrefix, events, loading, error, onRetry, value, onChange, emptyText }: EventChecklistProps) {
  const labelId = `${idPrefix}-events-label`;
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span id={labelId} className="text-[13px] font-semibold text-ink">
          Dodeljeni događaji
        </span>
        {events && events.length > 0 && (
          <span className="tabular text-xs text-ink-faint">
            {value.length} / {events.length}
          </span>
        )}
      </div>
      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Učitavanje">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : events === undefined ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2.5 text-sm text-ink-muted">
          <span>{errorMessage(error)}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Pokušaj ponovo
          </Button>
        </div>
      ) : events.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-3 py-3 text-sm text-ink-muted">{emptyText}</p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-md border border-line">
          {events.map((event) => {
            const id = `${idPrefix}-event-${event.id}`;
            return (
              <div key={event.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <Checkbox
                  id={id}
                  checked={value.includes(event.id)}
                  onCheckedChange={(checked) => onChange(checked === true ? [...value, event.id] : value.filter((v) => v !== event.id))}
                />
                <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-medium">
                  <span className="block truncate">{event.name}</span>
                  <span className="block truncate text-xs font-normal text-ink-muted">
                    {formatDateShort(event.startsAt)} · {event.venueName}
                  </span>
                </Label>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[13px] text-ink-muted">Skener radi samo za označene događaje.</p>
    </div>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreateStaffForm({ showOrganizer, onDone }: { showOrganizer: boolean; onDone: () => void }) {
  const queryClient = useQueryClient();
  const events = useEvents();
  const organizers = useQuery({
    queryKey: ORGANIZERS_KEY,
    queryFn: () => api.get<OrganizerDto[]>('/organizers'),
    enabled: showOrganizer,
  });

  const form = useForm<StaffCreateInput>({
    resolver: zodResolver(staffCreateSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', eventIds: [] },
  });
  const { errors } = form.formState;
  const organizerId = form.watch('organizerId');
  const eventIds = form.watch('eventIds');

  const visibleEvents = React.useMemo(() => {
    if (!events.data) return undefined;
    if (!showOrganizer) return events.data;
    return organizerId ? events.data.filter((event) => event.organizerId === organizerId) : [];
  }, [events.data, showOrganizer, organizerId]);

  const mutation = useMutation({
    mutationFn: (values: StaffCreateInput) => api.post<StaffDto>('/staff', values),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.success(`${fullName(result)} je dodat u osoblje.`);
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['organizerId', 'firstName', 'lastName', 'email', 'password', 'eventIds']),
  });

  const onSubmit = form.handleSubmit((values) => {
    if (showOrganizer && !values.organizerId) {
      form.setError('organizerId', { message: 'Izaberi organizatora.' });
      return;
    }
    mutation.mutate(values);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title="Dodaj člana osoblja" description="Nova osoba se prijavljuje email adresom i lozinkom koje ovde uneseš." />
      <DialogBody className="space-y-4">
        {showOrganizer && (
          <Field label="Organizator" htmlFor="staff-create-organizer" error={errors.organizerId?.message}>
            <Select
              value={organizerId ?? ''}
              onValueChange={(value) => {
                form.setValue('organizerId', value, { shouldDirty: true });
                form.clearErrors('organizerId');
                // Events belong to one organizer – a different organizer means a fresh selection.
                form.setValue('eventIds', []);
              }}
              disabled={organizers.isPending}
            >
              <SelectTrigger id="staff-create-organizer" aria-invalid={Boolean(errors.organizerId)}>
                <SelectValue placeholder={organizers.isError ? 'Organizatori nisu učitani' : 'Izaberi organizatora'} />
              </SelectTrigger>
              <SelectContent>
                {(organizers.data ?? []).map((organizer) => (
                  <SelectItem key={organizer.id} value={organizer.id}>
                    {organizer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ime" htmlFor="staff-create-first-name" error={errors.firstName?.message}>
            <Input id="staff-create-first-name" autoComplete="off" aria-invalid={Boolean(errors.firstName)} {...form.register('firstName')} />
          </Field>
          <Field label="Prezime" htmlFor="staff-create-last-name" error={errors.lastName?.message}>
            <Input id="staff-create-last-name" autoComplete="off" aria-invalid={Boolean(errors.lastName)} {...form.register('lastName')} />
          </Field>
        </div>
        <Field label="Email adresa" htmlFor="staff-create-email" error={errors.email?.message}>
          <Input id="staff-create-email" type="email" autoComplete="off" aria-invalid={Boolean(errors.email)} {...form.register('email')} />
        </Field>
        <Field label="Lozinka" htmlFor="staff-create-password" error={errors.password?.message} hint={PASSWORD_HINT}>
          <Input
            id="staff-create-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
        </Field>
        <EventChecklist
          idPrefix="staff-create"
          events={visibleEvents}
          loading={events.isPending}
          error={events.error}
          onRetry={() => void events.refetch()}
          value={eventIds ?? []}
          onChange={(value) => form.setValue('eventIds', value, { shouldDirty: true })}
          emptyText={
            showOrganizer && !organizerId
              ? 'Prvo izaberi organizatora da bi video njegove događaje.'
              : 'Još nema događaja. Događaje možeš da dodeliš i kasnije.'
          }
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={mutation.isPending}>
          Odustani
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Dodaj člana osoblja
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

interface StaffEditValues {
  firstName: string;
  lastName: string;
  eventIds: string[];
}

function EditStaffForm({ member, onDone }: { member: StaffDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const events = useEvents();
  const initialEventIds = React.useMemo(() => member.events.map((event) => event.id), [member.events]);

  const form = useForm<StaffEditValues>({
    resolver: zodResolver(staffUpdateSchema),
    defaultValues: { firstName: member.firstName, lastName: member.lastName, eventIds: initialEventIds },
  });
  const { errors } = form.formState;
  const eventIds = form.watch('eventIds');

  const visibleEvents = React.useMemo(
    () => events.data?.filter((event) => event.organizerId === member.organizerId),
    [events.data, member.organizerId],
  );

  const mutation = useMutation({
    mutationFn: (values: StaffUpdateInput) => api.patch<StaffDto>(`/staff/${member.id}`, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.success('Izmene su sačuvane.');
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['firstName', 'lastName', 'eventIds']),
  });

  const onSubmit = form.handleSubmit((values) => {
    // Assignments are replaced wholesale on the server, so send them only when they actually changed.
    const changed = values.eventIds.length !== initialEventIds.length || values.eventIds.some((id) => !initialEventIds.includes(id));
    mutation.mutate({ firstName: values.firstName, lastName: values.lastName, ...(changed ? { eventIds: values.eventIds } : {}) });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title="Izmeni člana osoblja" description={member.email} />
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ime" htmlFor="staff-edit-first-name" error={errors.firstName?.message}>
            <Input id="staff-edit-first-name" autoComplete="off" aria-invalid={Boolean(errors.firstName)} {...form.register('firstName')} />
          </Field>
          <Field label="Prezime" htmlFor="staff-edit-last-name" error={errors.lastName?.message}>
            <Input id="staff-edit-last-name" autoComplete="off" aria-invalid={Boolean(errors.lastName)} {...form.register('lastName')} />
          </Field>
        </div>
        <EventChecklist
          idPrefix="staff-edit"
          events={visibleEvents}
          loading={events.isPending}
          error={events.error}
          onRetry={() => void events.refetch()}
          value={eventIds}
          onChange={(value) => form.setValue('eventIds', value, { shouldDirty: true })}
          emptyText="Ovaj organizator još nema događaja."
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={mutation.isPending}>
          Odustani
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Sačuvaj izmene
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Password reset ──────────────────────────────────────────────────────────

function ResetPasswordForm({ member, onDone }: { member: StaffDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<PasswordResetInput>({ resolver: zodResolver(passwordResetSchema), defaultValues: { password: '' } });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: PasswordResetInput) => api.patch<StaffDto>(`/staff/${member.id}`, values satisfies StaffUpdateInput),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
      toast.success(`Nova lozinka je postavljena za: ${fullName(member)}.`);
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['password']),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader
        title="Postavi novu lozinku"
        description={`${fullName(member)} će biti odjavljen sa svih uređaja i moraće da se prijavi novom lozinkom.`}
      />
      <DialogBody>
        <Field label="Nova lozinka" htmlFor="staff-reset-password" error={errors.password?.message} hint={PASSWORD_HINT}>
          <Input
            id="staff-reset-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
        </Field>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={mutation.isPending}>
          Odustani
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Postavi lozinku
        </Button>
      </DialogFooter>
    </form>
  );
}
