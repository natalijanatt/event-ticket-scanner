import type { EventDto, EventInput } from '@event-platform/shared';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/controls';
import { ErrorState, PageHeader, Section } from '@/components/ui/states';
import { api } from '@/lib/api';
import { EventForm } from './event-form';
import { useOrganizers } from './event-queries';

export function EventNewPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const organizers = useOrganizers();

  async function create(input: EventInput) {
    const event = await api.post<EventDto>('/events', input);
    await queryClient.invalidateQueries({ queryKey: ['events'] });
    toast.success('Događaj je kreiran.', { description: 'Sledeći korak: dodaj goste i pošalji pozivnice.' });
    navigate(`/events/${event.id}/guests`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/events" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> Događaji
      </Link>
      <PageHeader title="Novi događaj" description="Tipovi karata Regular i VIP se dodaju automatski — možeš ih izmeniti kasnije u podešavanjima događaja." />
      {organizers.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : organizers.isError ? (
        <ErrorState error={organizers.error} onRetry={() => organizers.refetch()} />
      ) : (
        <Section>
          <EventForm organizers={organizers.data} submitLabel="Kreiraj događaj" onSubmit={create} onCancel={() => navigate('/events')} />
        </Section>
      )}
    </div>
  );
}
