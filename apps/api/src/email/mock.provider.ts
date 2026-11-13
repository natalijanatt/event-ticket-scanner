import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EmailSendError, type EmailProvider, type OutgoingEmail, type ProviderEmailEvent } from './email.types';

export interface StoredMockEmail {
  id: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  createdAt: string;
}

const MAX_STORED = 300;

/**
 * Development / test provider. Nothing leaves the machine:
 *  • messages are kept in a local outbox (`.mail-outbox/`), viewable in the
 *    admin panel under Podešavanja → Test sanduče,
 *  • the provider lifecycle is simulated so the UI shows realistic statuses:
 *      anything@…           → accepted, then "delivered" a moment later
 *      …@bounce.test        → accepted, then "bounced"
 *      …@fail.test          → rejected by the provider (permanent failure)
 *      …@flaky.test         → first attempt fails with a retryable error
 */
@Injectable()
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock' as const;
  /** Emits `ProviderEmailEvent`s, mimicking provider webhooks. */
  readonly events = new EventEmitter();
  /** Delay before the simulated delivery/bounce event. 0 = synchronous (tests). */
  simulatedDelayMs: number;

  private readonly logger = new Logger('MockEmail');
  private readonly dir: string | null;
  private readonly memory = new Map<string, StoredMockEmail>();
  private readonly seenKeys = new Map<string, string>();
  private readonly flakySeen = new Set<string>();

  constructor(config: AppConfig) {
    this.dir = config.isTest ? null : resolve(process.cwd(), '.mail-outbox');
    this.simulatedDelayMs = config.isTest ? 0 : 1500;
    if (this.dir && !existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  async send(message: OutgoingEmail): Promise<{ id: string }> {
    // Same contract as Resend: a repeated idempotency key returns the original result.
    const existing = this.seenKeys.get(message.idempotencyKey);
    if (existing) return { id: existing };

    const domain = message.to.split('@')[1] ?? '';
    if (domain === 'fail.test') throw new EmailSendError('Servis za slanje je odbio poruku (validation_error).', false);
    if (domain === 'flaky.test' && !this.flakySeen.has(message.idempotencyKey)) {
      this.flakySeen.add(message.idempotencyKey);
      throw new EmailSendError('Servis za slanje trenutno nije dostupan (simulacija).', true);
    }

    const id = `mock_${randomUUID()}`;
    this.seenKeys.set(message.idempotencyKey, id);
    this.store({ id, to: message.to, subject: message.subject, html: inlineCidImages(message), text: message.text, createdAt: new Date().toISOString() });
    this.logger.log(`E-mail captured in the local outbox (${id}): "${message.subject}"`);

    const event: ProviderEmailEvent = { messageId: id, type: domain === 'bounce.test' ? 'bounced' : 'delivered', at: new Date() };
    if (this.simulatedDelayMs > 0) {
      setTimeout(() => this.events.emit('event', { ...event, at: new Date() }), this.simulatedDelayMs).unref();
    } else {
      // Tests drive the lifecycle explicitly through `flushSimulatedEvents`.
      this.pending.push(event);
    }
    return { id };
  }

  private readonly pending: ProviderEmailEvent[] = [];

  /** Test helper: emits the queued simulated provider events. */
  flushSimulatedEvents(): ProviderEmailEvent[] {
    const events = this.pending.splice(0);
    for (const e of events) this.events.emit('event', e);
    return events;
  }

  list(): StoredMockEmail[] {
    return this.all().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): StoredMockEmail | undefined {
    return this.all().find((m) => m.id === id);
  }

  clear(): void {
    this.memory.clear();
    if (!this.dir) return;
    for (const file of readdirSync(this.dir)) if (file.endsWith('.json')) unlinkSync(join(this.dir, file));
  }

  private store(email: StoredMockEmail): void {
    if (!this.dir) {
      this.memory.set(email.id, email);
      return;
    }
    writeFileSync(join(this.dir, `${email.id}.json`), JSON.stringify(email), 'utf8');
    const files = readdirSync(this.dir).filter((f) => f.endsWith('.json'));
    if (files.length > MAX_STORED) {
      const sorted = files.map((f) => ({ f, at: this.read(f)?.createdAt ?? '' })).sort((a, b) => a.at.localeCompare(b.at));
      for (const { f } of sorted.slice(0, files.length - MAX_STORED)) unlinkSync(join(this.dir, f));
    }
  }

  private all(): StoredMockEmail[] {
    if (!this.dir) return [...this.memory.values()];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.read(f))
      .filter((m): m is StoredMockEmail => m !== null);
  }

  private read(file: string): StoredMockEmail | null {
    try {
      return JSON.parse(readFileSync(join(this.dir as string, file), 'utf8')) as StoredMockEmail;
    } catch {
      return null;
    }
  }
}

/** Browsers cannot resolve `cid:` references, so the outbox copy embeds the images as data URLs. */
function inlineCidImages(message: OutgoingEmail): string {
  let html = message.html;
  for (const a of message.attachments ?? []) {
    if (!a.contentId) continue;
    html = html.split(`cid:${a.contentId}`).join(`data:image/png;base64,${a.content.toString('base64')}`);
  }
  return html;
}
