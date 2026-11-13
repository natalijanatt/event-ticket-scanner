import {
  passwordSchema,
  USER_ROLE_LABELS,
  USER_ROLES,
  userCreateSchema,
  userUpdateSchema,
  type OrganizerDto,
  type UserCreateInput,
  type UserDto,
  type UserRole,
  type UserUpdateInput,
} from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Pencil, Plus, SearchX, UserCheck, UserX, Users } from 'lucide-react';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUser } from '@/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/controls';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Field, Input, SearchInput } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states';
import { Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/format';

const USERS_KEY = ['users'] as const;
const ORGANIZERS_KEY = ['organizers'] as const;

const PASSWORD_HINT = 'Najmanje 10 znakova, bar jedno slovo i jedna cifra.';

type RoleFilter = 'ALL' | UserRole;
const ROLE_FILTERS: { value: RoleFilter; label: string }[] = [
  { value: 'ALL', label: 'Svi' },
  { value: 'SUPER_ADMIN', label: 'Administratori' },
  { value: 'ORGANIZER', label: 'Organizatori' },
  { value: 'SCANNER', label: 'Osoblje' },
];

// Mirrors the API rule: everyone except a platform administrator belongs to an organizer.
const createSchema = userCreateSchema.superRefine((value, ctx) => {
  if (value.role !== 'SUPER_ADMIN' && !value.organizerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['organizerId'], message: 'Izaberi organizatora.' });
  }
});

const editSchema = userUpdateSchema.pick({ firstName: true, lastName: true }).required();
type UserEditInput = z.infer<typeof editSchema>;

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

export function UsersPage() {
  const me = useUser();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: () => api.get<UserDto[]>('/users') });

  const [search, setSearch] = React.useState('');
  const [roleFilter, setRoleFilter] = React.useState<RoleFilter>('ALL');
  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<UserDto | null>(null);
  const [resetting, setResetting] = React.useState<UserDto | null>(null);
  const [toggling, setToggling] = React.useState<UserDto | null>(null);

  const filtered = React.useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users.data ?? []).filter((user) => {
      if (roleFilter !== 'ALL' && user.role !== roleFilter) return false;
      if (!term) return true;
      return `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(term);
    });
  }, [users.data, search, roleFilter]);

  const setActive = useMutation({
    mutationFn: ({ user, isActive }: { user: UserDto; isActive: boolean }) =>
      api.patch<UserDto>(`/users/${user.id}`, { isActive } satisfies UserUpdateInput),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      toast.success(result.isActive ? `Nalog je aktiviran: ${fullName(result)}.` : `Nalog je deaktiviran: ${fullName(result)}.`);
      setToggling(null);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const addButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus aria-hidden /> Dodaj korisnika
    </Button>
  );

  const togglingActive = toggling?.isActive ?? true;

  return (
    <div className="space-y-6">
      <PageHeader title="Korisnici" description="Svi nalozi na platformi: administratori, organizatori i osoblje na ulazu." actions={addButton} />

      {users.isPending ? (
        <TableSkeleton rows={8} />
      ) : users.isError ? (
        <ErrorState error={users.error} onRetry={() => void users.refetch()} />
      ) : users.data.length === 0 ? (
        <EmptyState icon={Users} title="Još nema korisnika" description="Dodaj prvi korisnički nalog i dodeli mu ulogu." action={addButton} />
      ) : (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <SearchInput value={search} onValueChange={setSearch} placeholder="Pretraži po imenu ili email adresi" className="w-full lg:max-w-sm" />
            <div className="-mx-1 overflow-x-auto px-1">
              <Segmented label="Filter po ulozi" value={roleFilter} onChange={setRoleFilter} options={ROLE_FILTERS} className="whitespace-nowrap" />
            </div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={SearchX}
              title="Nema korisnika za ovaj prikaz"
              description="Nijedan nalog ne odgovara pretrazi i izabranoj ulozi."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSearch('');
                    setRoleFilter('ALL');
                  }}
                >
                  Poništi filtere
                </Button>
              }
            />
          ) : (
            <TableFrame>
              <Table>
                <thead>
                  <tr>
                    <Th>Korisnik</Th>
                    <Th className="hidden sm:table-cell">Uloga</Th>
                    <Th className="hidden md:table-cell">Organizator</Th>
                    <Th className="hidden md:table-cell">Poslednja prijava</Th>
                    <Th>Status</Th>
                    <Th className="w-12">
                      <span className="sr-only">Akcije</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((user) => {
                    const isSelf = user.id === me.id;
                    return (
                      <Tr key={user.id}>
                        <Td>
                          <div className="font-semibold text-ink">
                            {fullName(user)}
                            {isSelf && <span className="ml-2 text-xs font-medium text-ink-faint">(ti)</span>}
                          </div>
                          <div className="text-[13px] text-ink-muted">{user.email}</div>
                          <div className="mt-0.5 text-xs text-ink-faint sm:hidden">{USER_ROLE_LABELS[user.role]}</div>
                        </Td>
                        <Td className="hidden whitespace-nowrap sm:table-cell">{USER_ROLE_LABELS[user.role]}</Td>
                        <Td className="hidden max-w-xs text-ink-muted md:table-cell">
                          {user.organizers.length > 0 ? user.organizers.map((organizer) => organizer.name).join(', ') : '—'}
                        </Td>
                        <Td className="hidden whitespace-nowrap text-ink-muted md:table-cell">
                          {user.lastLoginAt ? formatRelative(user.lastLoginAt) : 'Nikad'}
                        </Td>
                        <Td>
                          <Badge tone={user.isActive ? 'success' : 'muted'}>{user.isActive ? 'Aktivan' : 'Deaktiviran'}</Badge>
                        </Td>
                        <Td className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={`Akcije za: ${fullName(user)}`}>
                                <MoreHorizontal aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                              <DropdownMenuItem onSelect={() => setEditing(user)}>
                                <Pencil aria-hidden /> Izmeni
                              </DropdownMenuItem>
                              <DropdownMenuItem onSelect={() => setResetting(user)}>
                                <KeyRound aria-hidden /> Postavi novu lozinku
                              </DropdownMenuItem>
                              {!user.isActive ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem onSelect={() => setToggling(user)}>
                                    <UserCheck aria-hidden /> Aktiviraj
                                  </DropdownMenuItem>
                                </>
                              ) : !isSelf ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem destructive onSelect={() => setToggling(user)}>
                                    <UserX aria-hidden /> Deaktiviraj
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableFrame>
          )}
        </>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <CreateUserForm onDone={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent size="sm">{editing && <EditUserForm user={editing} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent size="sm">
          {resetting && <ResetPasswordForm user={resetting} onDone={() => setResetting(null)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={toggling !== null}
        onOpenChange={(open) => !open && setToggling(null)}
        title={togglingActive ? 'Deaktiviraj nalog?' : 'Aktiviraj nalog?'}
        description={
          <>
            <strong className="font-semibold text-ink">{toggling ? fullName(toggling) : ''}</strong>{' '}
            {togglingActive
              ? 'odmah gubi pristup platformi i biće odjavljen sa svih uređaja. Nalog možeš ponovo da aktiviraš u svakom trenutku.'
              : 'će ponovo moći da se prijavi sa svojom email adresom i lozinkom.'}
          </>
        }
        confirmLabel={togglingActive ? 'Deaktiviraj' : 'Aktiviraj'}
        variant={togglingActive ? 'danger' : 'primary'}
        loading={setActive.isPending}
        onConfirm={() => toggling && setActive.mutate({ user: toggling, isActive: !toggling.isActive })}
      />
    </div>
  );
}

// ── Create ──────────────────────────────────────────────────────────────────

function CreateUserForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const organizers = useQuery({ queryKey: ORGANIZERS_KEY, queryFn: () => api.get<OrganizerDto[]>('/organizers') });

  const form = useForm<UserCreateInput>({
    resolver: zodResolver(createSchema),
    defaultValues: { firstName: '', lastName: '', email: '', password: '', role: 'ORGANIZER', organizerId: null },
  });
  const { errors } = form.formState;
  const role = form.watch('role');
  const organizerId = form.watch('organizerId');
  const needsOrganizer = role !== 'SUPER_ADMIN';

  const mutation = useMutation({
    mutationFn: (values: UserCreateInput) =>
      api.post<UserDto>('/users', { ...values, organizerId: values.role === 'SUPER_ADMIN' ? null : values.organizerId } satisfies UserCreateInput),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ORGANIZERS_KEY });
      if (result.role === 'SCANNER') void queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success(`Nalog je otvoren: ${fullName(result)}.`);
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['firstName', 'lastName', 'email', 'password', 'role', 'organizerId']),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title="Dodaj korisnika" description="Korisnik se prijavljuje email adresom i lozinkom koje ovde uneseš." />
      <DialogBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ime" htmlFor="user-create-first-name" error={errors.firstName?.message}>
            <Input id="user-create-first-name" autoComplete="off" aria-invalid={Boolean(errors.firstName)} {...form.register('firstName')} />
          </Field>
          <Field label="Prezime" htmlFor="user-create-last-name" error={errors.lastName?.message}>
            <Input id="user-create-last-name" autoComplete="off" aria-invalid={Boolean(errors.lastName)} {...form.register('lastName')} />
          </Field>
        </div>
        <Field label="Email adresa" htmlFor="user-create-email" error={errors.email?.message}>
          <Input id="user-create-email" type="email" autoComplete="off" aria-invalid={Boolean(errors.email)} {...form.register('email')} />
        </Field>
        <Field label="Lozinka" htmlFor="user-create-password" error={errors.password?.message} hint={PASSWORD_HINT}>
          <Input
            id="user-create-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(errors.password)}
            {...form.register('password')}
          />
        </Field>
        <Field label="Uloga" htmlFor="user-create-role" error={errors.role?.message}>
          <Select
            value={role}
            onValueChange={(value) => {
              const next = USER_ROLES.find((candidate) => candidate === value);
              if (!next) return;
              form.setValue('role', next, { shouldDirty: true });
              if (next === 'SUPER_ADMIN') form.clearErrors('organizerId');
            }}
          >
            <SelectTrigger id="user-create-role" aria-invalid={Boolean(errors.role)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {USER_ROLES.map((value) => (
                <SelectItem key={value} value={value}>
                  {USER_ROLE_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {needsOrganizer && (
          <Field
            label="Organizator"
            htmlFor="user-create-organizer"
            error={errors.organizerId?.message}
            hint={
              organizers.isError
                ? 'Organizatori nisu učitani. Zatvori prozor i pokušaj ponovo.'
                : organizers.data?.length === 0
                  ? 'Još nema organizatora. Prvo dodaj organizatora na stranici „Organizatori”.'
                  : undefined
            }
          >
            <Select
              value={organizerId ?? ''}
              onValueChange={(value) => {
                form.setValue('organizerId', value, { shouldDirty: true });
                form.clearErrors('organizerId');
              }}
              disabled={organizers.isPending || organizers.isError}
            >
              <SelectTrigger id="user-create-organizer" aria-invalid={Boolean(errors.organizerId)}>
                <SelectValue placeholder="Izaberi organizatora" />
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
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={mutation.isPending}>
          Odustani
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          Dodaj korisnika
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Edit ────────────────────────────────────────────────────────────────────

function EditUserForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<UserEditInput>({
    resolver: zodResolver(editSchema),
    defaultValues: { firstName: user.firstName, lastName: user.lastName },
  });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: UserEditInput) => api.patch<UserDto>(`/users/${user.id}`, values satisfies UserUpdateInput),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      if (result.role === 'SCANNER') void queryClient.invalidateQueries({ queryKey: ['staff'] });
      toast.success('Izmene su sačuvane.');
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['firstName', 'lastName']),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title="Izmeni korisnika" description={`${user.email} · ${USER_ROLE_LABELS[user.role]}`} />
      <DialogBody className="space-y-4">
        <Field label="Ime" htmlFor="user-edit-first-name" error={errors.firstName?.message}>
          <Input id="user-edit-first-name" autoComplete="off" aria-invalid={Boolean(errors.firstName)} {...form.register('firstName')} />
        </Field>
        <Field label="Prezime" htmlFor="user-edit-last-name" error={errors.lastName?.message}>
          <Input id="user-edit-last-name" autoComplete="off" aria-invalid={Boolean(errors.lastName)} {...form.register('lastName')} />
        </Field>
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

function ResetPasswordForm({ user, onDone }: { user: UserDto; onDone: () => void }) {
  const form = useForm<PasswordResetInput>({ resolver: zodResolver(passwordResetSchema), defaultValues: { password: '' } });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: PasswordResetInput) => api.patch<UserDto>(`/users/${user.id}`, values satisfies UserUpdateInput),
    onSuccess: () => {
      toast.success(`Nova lozinka je postavljena za: ${fullName(user)}.`);
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['password']),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader
        title="Postavi novu lozinku"
        description={`${fullName(user)} će biti odjavljen sa svih uređaja i moraće da se prijavi novom lozinkom.`}
      />
      <DialogBody>
        <Field label="Nova lozinka" htmlFor="user-reset-password" error={errors.password?.message} hint={PASSWORD_HINT}>
          <Input
            id="user-reset-password"
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
