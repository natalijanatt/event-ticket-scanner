import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { AppConfig } from '../config/app-config';
import { EmailSendError } from '../email/email.types';
import { DeliveryProcessor } from './delivery-processor.service';

export const INVITATION_QUEUE = Symbol('INVITATION_QUEUE');

export interface InvitationQueue {
  /** Schedules the deliveries for sending. Rejects if the queue is unavailable. */
  enqueue(deliveryIds: string[]): Promise<void>;
}

const QUEUE_NAME = 'invitation-emails';
const ATTEMPTS = 6;

/**
 * Background delivery through BullMQ + Redis.
 *  • retries: 6 attempts, exponential backoff starting at 5 s (5s, 10s, 20s, 40s, 80s)
 *  • provider rate limit: at most 2 sends per second across the worker; an
 *    explicit 429 pauses the queue for the provider's Retry-After
 *  • jobId = deliveryId → enqueueing the same delivery twice is a no-op
 */
@Injectable()
export class BullInvitationQueue implements InvitationQueue, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('InvitationQueue');
  private queue!: Queue;
  private worker!: Worker;
  private queueConnection!: IORedis;
  private workerConnection!: IORedis;

  constructor(
    private readonly config: AppConfig,
    private readonly processor: DeliveryProcessor,
  ) {}

  onModuleInit(): void {
    // Producer connection fails fast, so an HTTP request never hangs on a dead Redis.
    this.queueConnection = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.workerConnection = new IORedis(this.config.redisUrl, { maxRetriesPerRequest: null });
    let warned = false;
    const onError = (err: Error) => {
      if (!warned) this.logger.error(`Redis connection problem: ${err.message}. E-mail delivery is paused until Redis is reachable.`);
      warned = true;
    };
    this.queueConnection.on('error', onError);
    this.workerConnection.on('error', onError);
    this.queueConnection.on('ready', () => (warned = false));

    this.queue = new Queue(QUEUE_NAME, {
      connection: this.queueConnection,
      defaultJobOptions: {
        attempts: ATTEMPTS,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    });
    this.queue.on('error', () => undefined);

    this.worker = new Worker(QUEUE_NAME, (job) => this.handle(job), {
      connection: this.workerConnection,
      concurrency: 4,
      limiter: { max: 2, duration: 1000 },
    });
    this.worker.on('error', () => undefined);
  }

  async enqueue(deliveryIds: string[]): Promise<void> {
    await this.queue.addBulk(deliveryIds.map((deliveryId) => ({ name: 'send', data: { deliveryId }, opts: { jobId: deliveryId } })));
  }

  private async handle(job: Job<{ deliveryId: string }>): Promise<void> {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    try {
      await this.processor.process(job.data.deliveryId, { isLastAttempt });
    } catch (err) {
      if (err instanceof EmailSendError && err.retryAfterMs) {
        // Provider rate limit: pause the whole queue instead of burning an attempt.
        await this.worker.rateLimit(err.retryAfterMs);
        throw Worker.RateLimitError();
      }
      throw err;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.queueConnection?.disconnect();
    this.workerConnection?.disconnect();
  }
}

/**
 * Sends inside the calling request. For automated tests and Redis-less
 * environments (EMAIL_QUEUE_MODE=inline); retryable errors get a few
 * immediate attempts instead of delayed ones.
 */
@Injectable()
export class InlineInvitationQueue implements InvitationQueue {
  constructor(private readonly processor: DeliveryProcessor) {}

  async enqueue(deliveryIds: string[]): Promise<void> {
    for (const deliveryId of deliveryIds) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await this.processor.process(deliveryId, { isLastAttempt: attempt === 3 });
          break;
        } catch {
          /* retryable – try again */
        }
      }
    }
  }
}
