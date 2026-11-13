import { organizerInputSchema, type OrganizerDto, type OrganizerInput } from '@event-platform/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus } from 'lucide-react';
import * as React from 'react';
import { useForm, type FieldValues, type Path, type UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { EmptyState, ErrorState, PageHeader, TableSkeleton } from '@/components/ui/states';
import { Table, TableFrame, Td, Th, Tr } from '@/components/ui/table';
import { api, ApiError, errorMessage } from '@/lib/api';
import { formatDateShort, formatNumber } from '@/lib/format';

const ORGANIZERS_KEY = ['organizers'] as const;

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

export function OrganizersPage() {
  const organizers = useQuery({ queryKey: ORGANIZERS_KEY, queryFn: () => api.get<OrganizerDto[]>('/organizers') });

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OrganizerDto | null>(null);

  const addButton = (
    <Button onClick={() => setCreateOpen(true)}>
      <Plus aria-hidden /> Dodaj organizatora
    </Button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organizatori"
        description="Svaki organizator ima svoje događaje, goste i osoblje, potpuno odvojene od ostalih."
        actions={addButton}
      />

      {organizers.isPending ? (
        <TableSkeleton rows={5} />
      ) : organizers.isError ? (
        <ErrorState error={organizers.error} onRetry={() => void organizers.refetch()} />
      ) : organizers.data.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Još nema organizatora"
          description="Dodaj prvog organizatora da bi mogao da mu otvoriš korisničke naloge i događaje."
          action={addButton}
        />
      ) : (
        <TableFrame>
          <Table>
            <thead>
              <tr>
                <Th>Naziv</Th>
                <Th className="hidden sm:table-cell">Kontakt email</Th>
                <Th className="text-right">Događaji</Th>
                <Th className="hidden text-right sm:table-cell">Članovi</Th>
                <Th className="hidden text-right md:table-cell">Čuvanje podataka</Th>
                <Th className="hidden md:table-cell">Kreiran</Th>
                <Th className="w-12">
                  <span className="sr-only">Akcije</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {organizers.data.map((organizer) => (
                <Tr key={organizer.id}>
                  <Td>
                    <div className="font-semibold text-ink">{organizer.name}</div>
                    {organizer.contactEmail && <div className="text-[13px] text-ink-muted sm:hidden">{organizer.contactEmail}</div>}
                  </Td>
                  <Td className="hidden text-ink-muted sm:table-cell">{organizer.contactEmail ?? '—'}</Td>
                  <Td className="tabular text-right">{formatNumber(organizer.eventCount)}</Td>
                  <Td className="tabular hidden text-right sm:table-cell">{formatNumber(organizer.memberCount)}</Td>
                  <Td className="tabular hidden whitespace-nowrap text-right md:table-cell">
                    {organizer.retentionDays === 0 ? <span className="text-ink-faint">Isključeno</span> : `${formatNumber(organizer.retentionDays)} dana`}
                  </Td>
                  <Td className="hidden whitespace-nowrap text-ink-muted md:table-cell">{formatDateShort(organizer.createdAt)}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="icon-sm" aria-label={`Izmeni organizatora: ${organizer.name}`} onClick={() => setEditing(organizer)}>
                      <Pencil aria-hidden />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableFrame>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <OrganizerForm onDone={() => setCreateOpen(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>{editing && <OrganizerForm organizer={editing} onDone={() => setEditing(null)} />}</DialogContent>
      </Dialog>
    </div>
  );
}

function OrganizerForm({ organizer, onDone }: { organizer?: OrganizerDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const form = useForm<OrganizerInput>({
    resolver: zodResolver(organizerInputSchema),
    defaultValues: {
      name: organizer?.name ?? '',
      contactEmail: organizer?.contactEmail ?? '',
      retentionDays: organizer?.retentionDays ?? 365,
    },
  });
  const { errors } = form.formState;

  const mutation = useMutation({
    mutationFn: (values: OrganizerInput) =>
      organizer ? api.patch<OrganizerDto>(`/organizers/${organizer.id}`, values) : api.post<OrganizerDto>('/organizers', values),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ORGANIZERS_KEY });
      toast.success(organizer ? 'Izmene su sačuvane.' : `Organizator „${result.name}” je dodat.`);
      onDone();
    },
    onError: (err) => applyFormError(err, form, ['name', 'contactEmail', 'retentionDays']),
  });

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex min-h-0 flex-1 flex-col">
      <DialogHeader title={organizer ? 'Izmeni organizatora' : 'Dodaj organizatora'} />
      <DialogBody className="space-y-4">
        <Field label="Naziv" htmlFor="organizer-name" error={errors.name?.message}>
          <Input id="organizer-name" autoComplete="off" aria-invalid={Boolean(errors.name)} {...form.register('name')} />
        </Field>
        <Field label="Kontakt email" htmlFor="organizer-contact-email" optional error={errors.contactEmail?.message}>
          <Input
            id="organizer-contact-email"
            type="email"
            autoComplete="off"
            aria-invalid={Boolean(errors.contactEmail)}
            {...form.register('contactEmail')}
          />
        </Field>
        <Field
          label="Čuvanje ličnih podataka (dana)"
          htmlFor="organizer-retention-days"
          error={errors.retentionDays?.message}
          hint="Lični podaci gostiju se automatski anonimizuju ovoliko dana nakon završetka poslednjeg događaja. 0 isključuje automatsko brisanje."
        >
          <Input
            id="organizer-retention-days"
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
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={onDone} disabled={mutation.isPending}>
          Odustani
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {organizer ? 'Sačuvaj izmene' : 'Dodaj organizatora'}
        </Button>
      </DialogFooter>
    </form>
  );
}
