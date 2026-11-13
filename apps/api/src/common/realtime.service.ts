import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter, interval, map, merge } from 'rxjs';

export type RealtimeEventType = 'check-in' | 'tickets' | 'email';

interface RealtimeEvent {
  eventId: string;
  type: RealtimeEventType;
}

/**
 * In-process pub/sub behind the Server-Sent Events stream. The payload is
 * only a "something changed" hint – clients refetch through the normal,
 * authorized endpoints, so no guest data travels over the stream.
 *
 * Single-instance by design. To scale the API horizontally, publish these
 * hints through Redis pub/sub instead of the local Subject.
 */
@Injectable()
export class RealtimeService {
  private readonly subject = new Subject<RealtimeEvent>();

  publish(eventId: string, type: RealtimeEventType): void {
    this.subject.next({ eventId, type });
  }

  stream(eventId: string): Observable<{ data: { type: string } }> {
    const changes = this.subject.pipe(
      filter((e) => e.eventId === eventId),
      map((e) => ({ data: { type: e.type as string } })),
    );
    // Heartbeat keeps proxies from closing an idle connection.
    const heartbeat = interval(25_000).pipe(map(() => ({ data: { type: 'ping' } })));
    return merge(changes, heartbeat);
  }
}
