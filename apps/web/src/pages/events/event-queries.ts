import type { EventDto, EventStatsDto, OrganizerDto, TicketTypeDto } from '@event-platform/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '@/lib/api';

// Query-key layout: everything about one event lives under ['event', id, …],
// so a single prefix invalidation refreshes every open view of that event.
export const eventKeys = {
  list: (archived: boolean) => ['events', { archived }] as const,
  all: (eventId: string) => ['event', eventId] as const,
  detail: (eventId: string) => ['event', eventId, 'detail'] as const,
  ticketTypes: (eventId: string) => ['event', eventId, 'ticket-types'] as const,
  stats: (eventId: string) => ['event', eventId, 'stats'] as const,
  guests: (eventId: string, params: object) => ['event', eventId, 'guests', params] as const,
  tickets: (eventId: string, params: object) => ['event', eventId, 'tickets', params] as const,
  invitations: (eventId: string, params: object) => ['event', eventId, 'invitations', params] as const,
  checkIns: (eventId: string, params: object) => ['event', eventId, 'check-ins', params] as const,
  staff: (eventId: string) => ['event', eventId, 'staff'] as const,
};

export function useEvents(archived = false) {
  return useQuery({ queryKey: eventKeys.list(archived), queryFn: () => api.get<EventDto[]>(`/events?archived=${archived}`) });
}

export function useEvent(eventId: string) {
  return useQuery({ queryKey: eventKeys.detail(eventId), queryFn: () => api.get<EventDto>(`/events/${eventId}`) });
}

export function useTicketTypes(eventId: string) {
  return useQuery({ queryKey: eventKeys.ticketTypes(eventId), queryFn: () => api.get<TicketTypeDto[]>(`/events/${eventId}/ticket-types`) });
}

export function useEventStats(eventId: string) {
  return useQuery({
    queryKey: eventKeys.stats(eventId),
    queryFn: () => api.get<EventStatsDto>(`/events/${eventId}/stats`),
    // Fallback polling in case the live stream is blocked by a proxy.
    refetchInterval: 30_000,
  });
}

export function useOrganizers() {
  return useQuery({ queryKey: ['organizers'], queryFn: () => api.get<OrganizerDto[]>('/organizers'), staleTime: 60_000 });
}

/** The event loaded by <EventLayout>, available to every tab. */
export function useEventContext(): { event: EventDto } {
  return useOutletContext<{ event: EventDto }>();
}

/**
 * Live updates through Server-Sent Events. The stream carries only
 * "something changed" hints; on each hint the event's queries are refetched
 * through the normal authorized endpoints.
 */
export function useEventStream(eventId: string): void {
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const refresh = () => {
      // Collapse bursts (a busy entrance) into one refetch per second.
      if (pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        void queryClient.invalidateQueries({ queryKey: eventKeys.all(eventId) });
      }, 1000);
    };

    const connect = () => {
      if (closed) return;
      source = new EventSource(`/api/events/${eventId}/stream`, { withCredentials: true });
      source.onmessage = (message) => {
        try {
          if ((JSON.parse(message.data) as { type?: string }).type !== 'ping') refresh();
        } catch {
          /* ignore malformed frames */
        }
      };
      source.onerror = () => {
        source?.close();
        if (closed) return;
        // Most likely an expired access cookie: any API call renews the
        // session, after which the stream can reconnect.
        retry = setTimeout(() => {
          api
            .get('/auth/me')
            .catch(() => undefined)
            .finally(connect);
        }, 5000);
      };
    };
    connect();

    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
      if (pending) clearTimeout(pending);
    };
  }, [eventId, queryClient]);
}
