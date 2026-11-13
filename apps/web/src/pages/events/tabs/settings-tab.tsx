import { ticketTypeInputSchema, type EventDto, type EventInput, type StaffDto, type TicketTypeDto } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Pencil, Plus, Trash2, Users } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Checkbox, Skeleton } from '@/components/ui/controls';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { EmptyState, ErrorState, Section } from '@/components/ui/states';
import { api, errorMessage } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { EventForm } from '../event-form';
import { eventKeys, useEventContext, useOrganizers, useTicketTypes } from '../event-queries';

// A small fixed palette keeps ticket types distinguishable at the door.
const TYPE_COLORS = ['#5B6577', '#B8862B', '#3D6B8E', '#2F7D5B', '#A8483A', '#7A5C99', '#1B2434'];

type TypeValues = z.input<typeof ticketTypeInputSchema>;

function TicketTypeDialog({ eventId, type, open, onOpenChange }: { eventId: string; type?: TicketTypeDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const queryClient = useQueryClient();
  const form = useForm<TypeValues>({ resolver: zodResolver(ticketTypeInputSchema) });
  const { errors, isSubmitting } = form.formState;
  const color = form.watch('color');

  React.useEffect(() => {
    if (open) {
      form.reset({
        name: type?.name ?? '',
        description: type?.description ?? '',
        capacity: type?.capacity ?? ('' as unknown as number),
        color: type?.color ?? TYPE_COLORS[2],
        instructions: type?.instructions ?? '',
      });
    }
  }, [open, type, form]);

  const submit = form.handleSubmit(async (values) => {
    const body = { ...values, capacity: (values.capacity as unknown) === '' || values.capacity == null ? null : values.capacity };
    try {
      if (type) await api.patch(`/events/${eventId}/ticket-types/${type.id}`, body);
      else await api.post(`/events/${eventId}/ticket-types`, body);
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) });
      toast.success(type ? 'Tip karte je sačuvan.' : 'Tip karte je dodat.');
      onOpenChange(false);
    } catch (err) {
      applyServerErrors(form, err);
    }
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader title={type ? 'Izmena tipa karte' : 'Novi tip karte'} description="Tip karte se prikazuje osoblju pri skeniranju i gostu na ulaznici." />
          <DialogBody className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-[1fr_9rem]">
              <Field label="Naziv" htmlFor="tt-name" error={errors.name?.message}>
                <Input id="tt-name" placeholder="npr. Backstage" aria-invalid={!!errors.name} {...form.register('name')} />
              </Field>
              <Field label="Kapacitet" htmlFor="tt-capacity" optional error={errors.capacity?.message}>
                <Input id="tt-capacity" inputMode="numeric" placeholder="Bez limita" aria-invalid={!!errors.capacity} {...form.register('capacity')} />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-[13px] font-semibold">Boja</legend>
              <div className="flex flex-wrap gap-2">
                {TYPE_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Boja ${c}`}
                    aria-pressed={color === c}
                    onClick={() => form.setValue('color', c, { shouldDirty: true })}
                    className={cn('size-8 rounded-md border-2 border-surface ring-1 ring-line-strong transition-shadow', color === c && 'ring-2 ring-ink')}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </fieldset>
            <Field label="Opis" htmlFor="tt-description" optional error={errors.description?.message}>
              <Input id="tt-description" placeholder="npr. VIP zona i separe" {...form.register('description')} />
            </Field>
            <Field label="Uputstvo za gosta" htmlFor="tt-instructions" optional hint="Prikazuje se u pozivnici i na ulaznici." error={errors.instructions?.message}>
              <Textarea id="tt-instructions" rows={2} placeholder="npr. VIP ulaz je sa leve strane." {...form.register('instructions')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Odustani
            </Button>
            <Button type="submit" loading={isSubmitting}>
              {type ? 'Sačuvaj' : 'Dodaj tip'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketTypesSection({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const types = useTicketTypes(eventId);
  const [dialog, setDialog] = React.useState<{ type?: TicketTypeDto } | null>(null);
  const [deleting, setDeleting] = React.useState<TicketTypeDto | null>(null);

  const remove = useMutation({
    mutationFn: (type: TicketTypeDto) => api.delete(`/events/${eventId}/ticket-types/${type.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) });
      setDeleting(null);
      toast.success('Tip karte je obrisan.');
    },
    onError: (err) => {
      setDeleting(null);
      toast.error(errorMessage(err));
    },
  });

  return (
    <Section
      title="Tipovi karata"
      description="Regular, VIP, Backstage… Osoblje vidi tip karte čim skenira QR kod."
      actions={
        <Button size="sm" variant="secondary" onClick={() => setDialog({})}>
          <Plus /> Dodaj tip
        </Button>
      }
      bodyClassName="p-0"
    >
      {types.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : types.isError ? (
        <ErrorState error={types.error} onRetry={() => types.refetch()} className="border-0" />
      ) : types.data.length === 0 ? (
        <EmptyState bare icon={Plus} title="Nema tipova karata" description="Dodaj bar jedan tip da bi mogao/la da pozivaš goste." className="py-10" />
      ) : (
        <ul>
          {types.data.map((type) => (
            <li key={type.id} className="flex items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0">
              <span aria-hidden className="size-3 shrink-0 rounded-[3px]" style={{ backgroundColor: type.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{type.name}</div>
                {(type.description || type.instructions) && <div className="truncate text-[13px] text-ink-muted">{type.description ?? type.instructions}</div>}
              </div>
              <div className="tabular shrink-0 text-right text-[13px] text-ink-muted">
                <span className="font-semibold text-ink">{formatNumber(type.ticketCount)}</span>
                {type.capacity ? ` / ${formatNumber(type.capacity)}` : ''} izdato
              </div>
              <div className="flex shrink-0">
                <Button variant="ghost" size="icon-sm" aria-label={`Izmeni tip ${type.name}`} onClick={() => setDialog({ type })}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Obriši tip ${type.name}`} onClick={() => setDeleting(type)}>
                  <Trash2 />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <TicketTypeDialog eventId={eventId} type={dialog?.type} open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Brisanje tipa karte"
        description={
          <>
            Obrisati tip <strong className="text-ink">{deleting?.name}</strong>? Tip koji je već dodeljen gostima ne može biti obrisan.
          </>
        }
        confirmLabel="Obriši"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Section>
  );
}

function StaffSection({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient();
  const staff = useQuery({
    queryKey: eventKeys.staff(eventId),
    queryFn: () => api.get<{ assignedIds: string[]; staff: StaffDto[] }>(`/events/${eventId}/staff`),
  });

  const save = useMutation({
    mutationFn: (userIds: string[]) => api.put<{ assignedIds: string[] }>(`/events/${eventId}/staff`, { userIds }),
    onMutate: async (userIds) => {
      // Optimistic: the checkbox responds immediately, and rolls back on failure.
      await queryClient.cancelQueries({ queryKey: eventKeys.staff(eventId) });
      const previous = queryClient.getQueryData<{ assignedIds: string[]; staff: StaffDto[] }>(eventKeys.staff(eventId));
      if (previous) queryClient.setQueryData(eventKeys.staff(eventId), { ...previous, assignedIds: userIds });
      return { previous };
    },
    onError: (err, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(eventKeys.staff(eventId), context.previous);
      toast.error(errorMessage(err));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: eventKeys.staff(eventId) });
      void queryClient.invalidateQueries({ queryKey: ['staff'] });
    },
  });

  return (
    <Section title="Osoblje na ulazu" description="Samo označene osobe mogu da skeniraju karte za ovaj događaj." bodyClassName="p-0">
      {staff.isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : staff.isError ? (
        <ErrorState error={staff.error} onRetry={() => staff.refetch()} className="border-0" />
      ) : staff.data.staff.length === 0 ? (
        <EmptyState
          bare
          icon={Users}
          title="Još nemaš osoblje"
          description="Napravi naloge za ljude na ulazu, pa ih dodeli ovom događaju."
          className="py-10"
          action={
            <Button asChild variant="secondary">
              <Link to="/staff">Dodaj osoblje</Link>
            </Button>
          }
        />
      ) : (
        <ul>
          {staff.data.staff.map((person) => {
            const assigned = staff.data.assignedIds.includes(person.id);
            const id = `staff-${person.id}`;
            return (
              <li key={person.id} className="border-b border-line last:border-b-0">
                <label htmlFor={id} className={cn('flex cursor-pointer items-center gap-3 px-5 py-3 hover:bg-subtle/50', !person.isActive && 'opacity-60')}>
                  <Checkbox
                    id={id}
                    checked={assigned}
                    disabled={!person.isActive && !assigned}
                    onCheckedChange={(v) => save.mutate(v === true ? [...staff.data.assignedIds, person.id] : staff.data.assignedIds.filter((x) => x !== person.id))}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">
                      {person.firstName} {person.lastName}
                    </span>
                    <span className="block truncate text-[13px] text-ink-muted">{person.email}</span>
                  </span>
                  {!person.isActive && <span className="text-xs font-medium text-ink-muted">Deaktiviran</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function CoverSection({ event }: { event: EventDto }) {
  const queryClient = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<EventDto>(`/events/${event.id}/cover`, form);
    },
    onSuccess: async () => {
      await refresh();
      toast.success('Naslovna slika je sačuvana.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete<EventDto>(`/events/${event.id}/cover`),
    onSuccess: async () => {
      await refresh();
      toast.success('Naslovna slika je uklonjena.');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return (
    <Section title="Naslovna slika" description="Prikazuje se u pozivnici i na ulaznici gosta. JPG, PNG ili WebP do 5 MB.">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Naslovna slika"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) toast.error('Slika je veća od 5 MB.');
          else upload.mutate(file);
        }}
      />
      {event.coverImageUrl ? (
        <div className="space-y-3">
          <img src={event.coverImageUrl} alt="Naslovna slika događaja" className="aspect-[2/1] w-full rounded-md border border-line object-cover" />
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" loading={upload.isPending} onClick={() => inputRef.current?.click()}>
              Zameni sliku
            </Button>
            <Button variant="ghost" size="sm" loading={remove.isPending} onClick={() => remove.mutate()}>
              Ukloni
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={upload.isPending}
          className="flex aspect-[2/1] w-full flex-col items-center justify-center rounded-md border border-dashed border-line-strong bg-subtle/40 text-center transition-colors hover:border-ink-faint hover:bg-subtle"
        >
          <ImagePlus className="size-6 text-ink-muted" strokeWidth={1.5} aria-hidden />
          <span className="mt-2 text-sm font-semibold">{upload.isPending ? 'Otpremanje…' : 'Dodaj sliku'}</span>
        </button>
      )}
    </Section>
  );
}

export function EventSettingsTab() {
  const { event } = useEventContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizers = useOrganizers();
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  async function save(input: EventInput) {
    const { organizerId: _organizerId, ...patch } = input;
    await api.patch<EventDto>(`/events/${event.id}`, patch);
    await Promise.all([queryClient.invalidateQueries({ queryKey: eventKeys.all(event.id) }), queryClient.invalidateQueries({ queryKey: ['events'] })]);
    toast.success('Izmene su sačuvane.');
  }

  const remove = useMutation({
    mutationFn: () => api.delete(`/events/${event.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['events'] });
      toast.success('Događaj je obrisan.');
      navigate('/events', { replace: true });
    },
    onError: (err) => {
      setDeleteOpen(false);
      toast.error(errorMessage(err));
    },
  });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Section title="Podaci o događaju">
        <EventForm key={event.updatedAt} event={event} organizers={organizers.data ?? []} submitLabel="Sačuvaj izmene" onSubmit={save} />
      </Section>

      <div className="space-y-6">
        <TicketTypesSection eventId={event.id} />
        <StaffSection eventId={event.id} />
        <CoverSection event={event} />
        <Section title="Brisanje događaja" description="Moguće je samo dok nijedna karta nije izdata. Događaj sa kartama možeš arhivirati iz menija u zaglavlju.">
          <Button variant="danger-outline" onClick={() => setDeleteOpen(true)} disabled={event.counts.tickets > 0}>
            <Trash2 /> Obriši događaj
          </Button>
        </Section>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Brisanje događaja"
        description={
          <>
            Trajno obrisati <strong className="text-ink">{event.name}</strong> zajedno sa listom gostiju? Ova radnja se ne može opozvati.
          </>
        }
        confirmLabel="Obriši događaj"
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}
