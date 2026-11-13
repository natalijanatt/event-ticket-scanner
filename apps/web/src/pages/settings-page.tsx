import {
  changePasswordSchema,
  organizerInputSchema,
  updateProfileSchema,
  USER_ROLE_LABELS,
  type AppConfigDto,
  type AuthUser,
  type ChangePasswordInput,
  type MailboxMessageDto,
  type OrganizerDto,
  type OrganizerInput,
  type UpdateProfileInput,
} from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, ChevronRight, Inbox, RefreshCw, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { useAuth, useUser } from '@/auth/auth-context';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/controls';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, Section } from '@/components/ui/states';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateTime, formatNumber, formatRelative, plural } from '@/lib/format';

const ORGANIZERS_KEY = ['organizers'] as const;
const CONFIG_KEY = ['auth', 'config'] as const;
const MAILBOX_KEY = ['dev-mailbox'] as const;

const PASSWORD_HINT = 'Najmanje 10 znakova, bar jedno slovo i jedna cifra.';
const RETENTION_HINT =
  'Lični podaci gostiju se automatski anonimizuju ovoliko dana nakon završetka poslednjeg događaja. 0 isključuje automatsko brisanje.';

interface MailboxMessageDetail extends MailboxMessageDto {
  html: string;
}

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

export function SettingsPage() {
  const config = useQuery({ queryKey: CONFIG_KEY, queryFn: () => api.get<AppConfigDto>('/auth/config'), staleTime: 5 * 60_000 });

  return (
    <div className="space-y-6">
      <PageHeader title="Podešavanja" description="Tvoj nalog, podaci organizatora i način slanja pozivnica." />
      <ProfileSection />
      <PasswordSection />
      <OrganizersSection />
      <Section title="Slanje mejlova" description="Kako pozivnice i karte stižu do gostiju.">
        {config.isPending ? (
          <div className="space-y-2" aria-busy="true" aria-label="Učitavanje">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
        ) : config.isError ? (
          <ErrorState error={config.error} onRetry={() => void config.refetch()} className="border-0 px-0 py-6" />
        ) : config.data.emailMode === 'resend' ? (
          <div className="space-y-2">
            <Badge tone="success">Stvarno slanje je aktivno</Badge>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              Mejlovi se isporučuju gostima preko servisa Resend. Status isporuke svake pozivnice vidiš na kartici „Pozivnice” u okviru događaja.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Badge tone="warning">Test režim</Badge>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              U test režimu nijedan stvarni mejl ne napušta sistem. Sve poruke završavaju u test sandučetu ispod, gde možeš da ih otvoriš i pregledaš
              tačno onako kako bi ih gost video.
            </p>
            <p className="max-w-2xl text-sm leading-relaxed text-ink-muted">
              Za probu grešaka koristi simulacione adrese: adresa koja se završava na{' '}
              <code className="rounded-sm bg-subtle px-1 py-0.5 text-[13px] text-ink">@bounce.test</code> simulira odbijenu isporuku, a{' '}
              <code className="rounded-sm bg-subtle px-1 py-0.5 text-[13px] text-ink">@fail.test</code> neuspelo slanje.
            </p>
          </div>
        )}
      </Section>
      {config.data?.emailMode === 'mock' && <TestMailboxSection />}
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

function ProfileSection() {
  const user = useUser();
  const { setUser } = useAuth();
  const form = useForm<UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { firstName: user.firstName, lastName: user.lastName },
  });
  const { errors, isDirty } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: UpdateProfileInput) => api.patch<AuthUser>('/auth/me', values),
    onSuccess: (result) => {
      setUser(result);
      form.reset({ firstName: result.firstName, lastName: result.lastName });
      toast.success('Profil je sačuvan.');
    },
    onError: (err) => applyFormError(err, form, ['firstName', 'lastName']),
  });

  return (
    <Section title="Profil" description="Ime pod kojim te vide ostali članovi tima.">
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="max-w-xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ime" htmlFor="profile-first-name" error={errors.firstName?.message}>
            <Input id="profile-first-name" autoComplete="given-name" aria-invalid={Boolean(errors.firstName)} {...form.register('firstName')} />
          </Field>
          <Field label="Prezime" htmlFor="profile-last-name" error={errors.lastName?.message}>
            <Input id="profile-last-name" autoComplete="family-name" aria-invalid={Boolean(errors.lastName)} {...form.register('lastName')} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email adresa" htmlFor="profile-email" hint="Email adresa se ne može menjati.">
            <Input id="profile-email" type="email" value={user.email} readOnly disabled />
          </Field>
          <Field label="Uloga" htmlFor="profile-role">
            <Input id="profile-role" value={USER_ROLE_LABELS[user.role]} readOnly disabled />
          </Field>
        </div>
        <Button type="submit" loading={mutation.isPending} disabled={!isDirty}>
          Sačuvaj profil
        </Button>
      </form>
    </Section>
  );
}

// ── Password ────────────────────────────────────────────────────────────────

function PasswordSection() {
  const form = useForm<ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: '', newPassword: '' },
  });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: ChangePasswordInput) => api.post<{ ok: true }>('/auth/change-password', values),
    onSuccess: () => {
      form.reset();
      toast.success('Lozinka je promenjena. Ostali uređaji su odjavljeni.');
    },
    onError: (err) => applyFormError(err, form, ['currentPassword', 'newPassword']),
  });

  return (
    <Section title="Lozinka" description="Posle promene lozinke bićeš odjavljen sa svih ostalih uređaja. Na ovom uređaju ostaješ prijavljen.">
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="max-w-xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trenutna lozinka" htmlFor="password-current" error={errors.currentPassword?.message}>
            <Input
              id="password-current"
              type="password"
              autoComplete="current-password"
              aria-invalid={Boolean(errors.currentPassword)}
              {...form.register('currentPassword')}
            />
          </Field>
          <Field label="Nova lozinka" htmlFor="password-new" error={errors.newPassword?.message} hint={PASSWORD_HINT}>
            <Input
              id="password-new"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.newPassword)}
              {...form.register('newPassword')}
            />
          </Field>
        </div>
        <Button type="submit" loading={mutation.isPending}>
          Promeni lozinku
        </Button>
      </form>
    </Section>
  );
}

// ── Organizers ──────────────────────────────────────────────────────────────

function OrganizersSection() {
  const user = useUser();
  const organizers = useQuery({ queryKey: ORGANIZERS_KEY, queryFn: () => api.get<OrganizerDto[]>('/organizers') });

  return (
    <Section title="Organizator" description="Podaci organizatora i pravila čuvanja ličnih podataka gostiju." bodyClassName="p-0">
      {organizers.isPending ? (
        <div className="max-w-xl space-y-4 p-5" aria-busy="true" aria-label="Učitavanje">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-40" />
        </div>
      ) : organizers.isError ? (
        <ErrorState error={organizers.error} onRetry={() => void organizers.refetch()} className="border-0" />
      ) : organizers.data.length === 0 ? (
        <EmptyState
          bare
          icon={Building2}
          title="Nema organizatora"
          description={
            user.role === 'SUPER_ADMIN'
              ? 'Na platformi još nema organizatora. Dodaj ih na stranici „Organizatori”.'
              : 'Tvoj nalog nije povezan ni sa jednim organizatorom. Obrati se administratoru platforme.'
          }
          action={
            <Button variant="secondary" onClick={() => void organizers.refetch()} loading={organizers.isFetching}>
              <RefreshCw aria-hidden /> Osveži
            </Button>
          }
        />
      ) : (
        <div className="divide-y divide-line">
          {organizers.data.map((organizer) => (
            <OrganizerBlock key={organizer.id} organizer={organizer} showHeading={organizers.data.length > 1} />
          ))}
        </div>
      )}
    </Section>
  );
}

function OrganizerBlock({ organizer, showHeading }: { organizer: OrganizerDto; showHeading: boolean }) {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const idPrefix = `organizer-${organizer.id}`;

  const form = useForm<OrganizerInput>({
    resolver: zodResolver(organizerInputSchema),
    defaultValues: { name: organizer.name, contactEmail: organizer.contactEmail ?? '', retentionDays: organizer.retentionDays },
  });
  const { errors, isDirty } = form.formState;

  const save = useMutation({
    mutationFn: (values: OrganizerInput) => api.patch<OrganizerDto>(`/organizers/${organizer.id}`, values),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ORGANIZERS_KEY });
      form.reset({ name: result.name, contactEmail: result.contactEmail ?? '', retentionDays: result.retentionDays });
      toast.success('Podaci organizatora su sačuvani.');
    },
    onError: (err) => applyFormError(err, form, ['name', 'contactEmail', 'retentionDays']),
  });

  const runRetention = useMutation({
    mutationFn: () => api.post<{ anonymized: number }>(`/organizers/${organizer.id}/retention/run`),
    onSuccess: ({ anonymized }) => {
      setConfirmOpen(false);
      toast.success(
        anonymized === 0
          ? 'Čišćenje je završeno. Nema podataka kojima je istekao rok čuvanja.'
          : `Čišćenje je završeno. Anonimizovani su podaci za ${formatNumber(anonymized)} ${plural(anonymized, 'gosta', 'gosta', 'gostiju')}.`,
      );
    },
    onError: (err) => {
      setConfirmOpen(false);
      toast.error(errorMessage(err));
    },
  });

  // The cleanup always uses the saved value, not what is currently typed into the form.
  const retentionOff = organizer.retentionDays === 0;

  return (
    <div className="p-5">
      {showHeading && <h3 className="mb-4 text-sm font-semibold text-ink">{organizer.name}</h3>}
      <form onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate className="max-w-xl space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Naziv" htmlFor={`${idPrefix}-name`} error={errors.name?.message}>
            <Input id={`${idPrefix}-name`} autoComplete="organization" aria-invalid={Boolean(errors.name)} {...form.register('name')} />
          </Field>
          <Field label="Kontakt email" htmlFor={`${idPrefix}-contact-email`} optional error={errors.contactEmail?.message}>
            <Input
              id={`${idPrefix}-contact-email`}
              type="email"
              autoComplete="off"
              aria-invalid={Boolean(errors.contactEmail)}
              {...form.register('contactEmail')}
            />
          </Field>
        </div>
        <Field label="Čuvanje ličnih podataka (dana)" htmlFor={`${idPrefix}-retention-days`} error={errors.retentionDays?.message} hint={RETENTION_HINT}>
          <Input
            id={`${idPrefix}-retention-days`}
            type="number"
            inputMode="numeric"
            min={0}
            max={3650}
            step={1}
            className="sm:max-w-[160px]"
            aria-invalid={Boolean(errors.retentionDays)}
            {...form.register('retentionDays', { valueAsNumber: true })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>
            Sačuvaj
          </Button>
          <Button variant="secondary" onClick={() => setConfirmOpen(true)} disabled={retentionOff || isDirty}>
            Pokreni čišćenje sada
          </Button>
        </div>
        {retentionOff ? (
          <p className="text-[13px] text-ink-muted">Automatsko brisanje je isključeno, pa čišćenje nema šta da uradi.</p>
        ) : isDirty ? (
          <p className="text-[13px] text-ink-muted">Sačuvaj izmene pre nego što pokreneš čišćenje.</p>
        ) : null}
      </form>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Pokreni čišćenje podataka?"
        description={
          <>
            Lični podaci gostiju organizatora <strong className="font-semibold text-ink">{organizer.name}</strong> čiji su se svi događaji završili pre
            više od {formatNumber(organizer.retentionDays)} dana biće trajno anonimizovani. Ovo se ne može poništiti.
          </>
        }
        confirmLabel="Pokreni čišćenje"
        loading={runRetention.isPending}
        onConfirm={() => runRetention.mutate()}
      />
    </div>
  );
}

// ── Test mailbox (mock e-mail mode only) ────────────────────────────────────

function TestMailboxSection() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = React.useState<string | null>(null);

  const mailbox = useQuery({
    queryKey: MAILBOX_KEY,
    queryFn: () => api.get<MailboxMessageDto[]>('/dev/mailbox'),
    refetchInterval: 5000,
  });

  const clear = useMutation({
    mutationFn: () => api.delete<{ ok: true }>('/dev/mailbox'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MAILBOX_KEY });
      toast.success('Test sanduče je ispražnjeno.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const messages = mailbox.data ?? [];

  return (
    <Section
      title="Test sanduče"
      description="Poruke koje bi u stvarnom radu bile poslate gostima. Lista se osvežava na svakih 5 sekundi."
      bodyClassName="p-0"
      actions={
        <Button variant="secondary" size="sm" onClick={() => clear.mutate()} loading={clear.isPending} disabled={messages.length === 0}>
          <Trash2 aria-hidden /> Isprazni sanduče
        </Button>
      }
    >
      {mailbox.isPending ? (
        <div className="space-y-3 p-5" aria-busy="true" aria-label="Učitavanje">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      ) : mailbox.isError ? (
        <ErrorState error={mailbox.error} onRetry={() => void mailbox.refetch()} className="border-0" />
      ) : messages.length === 0 ? (
        <EmptyState
          bare
          icon={Inbox}
          title="Sanduče je prazno"
          description="Pošalji pozivnicu sa nekog događaja i poruka će se pojaviti ovde za nekoliko sekundi."
          action={
            <Button variant="secondary" onClick={() => void mailbox.refetch()} loading={mailbox.isFetching}>
              <RefreshCw aria-hidden /> Osveži
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {messages.map((message) => (
            <li key={message.id}>
              <button
                type="button"
                onClick={() => setOpenId(message.id)}
                className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-subtle/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{message.subject}</span>
                  <span className="block truncate text-[13px] text-ink-muted">{message.to}</span>
                </span>
                <span className="shrink-0 whitespace-nowrap text-xs text-ink-faint">{formatRelative(message.createdAt)}</span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={openId !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent size="xl">{openId && <MailboxMessage id={openId} />}</DialogContent>
      </Dialog>
    </Section>
  );
}

function MailboxMessage({ id }: { id: string }) {
  const message = useQuery({
    queryKey: [...MAILBOX_KEY, id] as const,
    queryFn: () => api.get<MailboxMessageDetail>(`/dev/mailbox/${encodeURIComponent(id)}`),
    staleTime: Infinity,
  });

  return (
    <>
      <DialogHeader
        title={message.data?.subject ?? 'Poruka'}
        description={message.data ? `Za: ${message.data.to} · ${formatDateTime(message.data.createdAt)}` : undefined}
      />
      <DialogBody>
        {message.isPending ? (
          <div aria-busy="true" aria-label="Učitavanje">
            <Skeleton className="h-[70vh] w-full" />
          </div>
        ) : message.isError ? (
          <ErrorState error={message.error} onRetry={() => void message.refetch()} className="border-0" />
        ) : (
          <iframe
            sandbox=""
            srcDoc={message.data.html}
            title={`Sadržaj poruke: ${message.data.subject}`}
            className="h-[70vh] w-full rounded-md border border-line bg-white"
          />
        )}
      </DialogBody>
    </>
  );
}
