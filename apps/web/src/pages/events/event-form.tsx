import { EVENT_STATUS_LABELS, EVENT_STATUSES, type EventDto, type EventInput, type OrganizerDto } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/controls';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fromDateTimeInputs, toDateInput, toTimeInput } from '@/lib/format';
import { applyServerErrors } from '@/lib/forms';

// The form works with separate date/time strings (native pickers) and
// converts to the API's ISO timestamps on submit.
const formSchema = z
  .object({
    organizerId: z.string().optional(),
    name: z.string().trim().min(1, 'Naziv događaja je obavezno polje.').max(120, 'Najviše 120 znakova.'),
    description: z.string().max(5000, 'Najviše 5000 znakova.'),
    date: z.string().min(1, 'Izaberi datum.'),
    time: z.string().min(1, 'Izaberi vreme početka.'),
    endDate: z.string(),
    endTime: z.string(),
    venueName: z.string().trim().min(1, 'Naziv lokacije je obavezno polje.').max(120, 'Najviše 120 znakova.'),
    venueAddress: z.string().max(240, 'Najviše 240 znakova.'),
    capacity: z.string().regex(/^\d*$/, 'Unesi ceo broj.'),
    enforceCapacity: z.boolean(),
    status: z.enum(EVENT_STATUSES),
  })
  .superRefine((v, ctx) => {
    if (Boolean(v.endDate) !== Boolean(v.endTime)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Unesi i datum i vreme završetka, ili ostavi oba prazna.' });
      return;
    }
    const start = fromDateTimeInputs(v.date, v.time);
    const end = fromDateTimeInputs(v.endDate, v.endTime);
    if (start && end && new Date(end) <= new Date(start)) {
      ctx.addIssue({ code: 'custom', path: ['endTime'], message: 'Kraj događaja mora biti posle početka.' });
    }
    if (v.capacity !== '' && Number(v.capacity) < 1) {
      ctx.addIssue({ code: 'custom', path: ['capacity'], message: 'Kapacitet mora biti najmanje 1.' });
    }
  });

type FormValues = z.infer<typeof formSchema>;

function defaults(event: EventDto | undefined, organizers: OrganizerDto[]): FormValues {
  return {
    organizerId: event?.organizerId ?? (organizers.length === 1 ? organizers[0].id : undefined),
    name: event?.name ?? '',
    description: event?.description ?? '',
    date: toDateInput(event?.startsAt),
    time: event ? toTimeInput(event.startsAt) : '22:00',
    endDate: toDateInput(event?.endsAt),
    endTime: toTimeInput(event?.endsAt),
    venueName: event?.venueName ?? '',
    venueAddress: event?.venueAddress ?? '',
    capacity: event?.capacity ? String(event.capacity) : '',
    enforceCapacity: event?.enforceCapacity ?? false,
    // New events are active by default so invitations can be sent right away.
    status: event?.status ?? 'ACTIVE',
  };
}

interface EventFormProps {
  event?: EventDto;
  organizers: OrganizerDto[];
  submitLabel: string;
  onSubmit: (input: EventInput) => Promise<unknown>;
  onCancel?: () => void;
}

export function EventForm({ event, organizers, submitLabel, onSubmit, onCancel }: EventFormProps) {
  const form = useForm<FormValues>({ resolver: zodResolver(formSchema), defaultValues: defaults(event, organizers) });
  const { errors, isSubmitting, isDirty } = form.formState;
  const hasCapacity = form.watch('capacity') !== '';
  const needsOrganizer = !event && organizers.length > 1;

  const submit = form.handleSubmit(async (values) => {
    if (needsOrganizer && !values.organizerId) {
      form.setError('organizerId', { message: 'Izaberi organizatora.' });
      return;
    }
    const input: EventInput = {
      organizerId: event ? undefined : values.organizerId,
      name: values.name,
      description: values.description.trim() || null,
      startsAt: fromDateTimeInputs(values.date, values.time) as string,
      endsAt: fromDateTimeInputs(values.endDate, values.endTime),
      venueName: values.venueName,
      venueAddress: values.venueAddress.trim() || null,
      capacity: values.capacity === '' ? null : Number(values.capacity),
      enforceCapacity: values.capacity !== '' && values.enforceCapacity,
      status: values.status,
    };
    try {
      await onSubmit(input);
      form.reset(values);
    } catch (err) {
      applyServerErrors(form, err);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      <fieldset className="space-y-5">
        <legend className="eyebrow mb-4">Osnovno</legend>
        {needsOrganizer && (
          <Field label="Organizator" htmlFor="organizerId" error={errors.organizerId?.message}>
            <Controller
              control={form.control}
              name="organizerId"
              render={({ field }) => (
                <Select value={field.value ?? ''} onValueChange={field.onChange}>
                  <SelectTrigger id="organizerId" aria-invalid={!!errors.organizerId}>
                    <SelectValue placeholder="Izaberi organizatora" />
                  </SelectTrigger>
                  <SelectContent>
                    {organizers.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        )}
        <Field label="Naziv događaja" htmlFor="name" error={errors.name?.message}>
          <Input id="name" placeholder="npr. Friday Night Party" aria-invalid={!!errors.name} {...form.register('name')} />
        </Field>
        <Field label="Opis" htmlFor="description" optional error={errors.description?.message}>
          <Textarea id="description" rows={4} placeholder="Kratak opis za tvoju evidenciju." aria-invalid={!!errors.description} {...form.register('description')} />
        </Field>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="eyebrow mb-4">Vreme</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Datum početka" htmlFor="date" error={errors.date?.message}>
            <Input id="date" type="date" aria-invalid={!!errors.date} {...form.register('date')} />
          </Field>
          <Field label="Vreme početka" htmlFor="time" error={errors.time?.message}>
            <Input id="time" type="time" aria-invalid={!!errors.time} {...form.register('time')} />
          </Field>
          <Field label="Datum završetka" htmlFor="endDate" optional error={errors.endDate?.message}>
            <Input id="endDate" type="date" aria-invalid={!!errors.endDate} {...form.register('endDate')} />
          </Field>
          <Field
            label="Vreme završetka"
            htmlFor="endTime"
            optional
            error={errors.endTime?.message}
            hint="Bez unetog kraja, skeniranje se zatvara 15 sati posle početka."
          >
            <Input id="endTime" type="time" aria-invalid={!!errors.endTime} {...form.register('endTime')} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="eyebrow mb-4">Lokacija</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Naziv lokacije" htmlFor="venueName" error={errors.venueName?.message}>
            <Input id="venueName" placeholder="npr. Club Central" aria-invalid={!!errors.venueName} {...form.register('venueName')} />
          </Field>
          <Field label="Adresa" htmlFor="venueAddress" optional error={errors.venueAddress?.message}>
            <Input id="venueAddress" placeholder="Ulica i broj, grad" aria-invalid={!!errors.venueAddress} {...form.register('venueAddress')} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="eyebrow mb-4">Kapacitet i status</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Maksimalan kapacitet" htmlFor="capacity" optional error={errors.capacity?.message} hint="Ukupan broj osoba koje mogu da uđu.">
            <Input id="capacity" inputMode="numeric" placeholder="Bez ograničenja" aria-invalid={!!errors.capacity} {...form.register('capacity')} />
          </Field>
          <Field
            label="Status"
            htmlFor="status"
            hint={form.watch('status') === 'DRAFT' ? 'U nacrtu se pozivnice ne mogu slati niti karte skenirati.' : undefined}
          >
            <Controller
              control={form.control}
              name="status"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {EVENT_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        </div>
        <Controller
          control={form.control}
          name="enforceCapacity"
          render={({ field }) => (
            <label className={`flex items-start gap-3 rounded-md border border-line p-4 ${hasCapacity ? '' : 'opacity-60'}`}>
              <Switch checked={hasCapacity && field.value} onCheckedChange={field.onChange} disabled={!hasCapacity} aria-describedby="enforce-hint" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Zaustavi ulaz kada se kapacitet popuni</span>
                <span id="enforce-hint" className="mt-0.5 block text-[13px] text-ink-muted">
                  Skener odbija nove ulaske čim broj prijavljenih dostigne kapacitet — čak i kada više skenera radi istovremeno.
                </span>
              </span>
            </label>
          )}
        />
      </fieldset>

      <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Odustani
          </Button>
        )}
        <Button type="submit" loading={isSubmitting} disabled={Boolean(event) && !isDirty}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
