export interface EmailAttachment {
  filename: string;
  content: Buffer;
  /** When set, the attachment is inline and referenced as `cid:<contentId>`. */
  contentId?: string;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Sent to the provider so a retried request can never produce a second e-mail. */
  idempotencyKey: string;
  attachments?: EmailAttachment[];
}

export interface EmailProvider {
  readonly name: 'mock' | 'resend';
  /** Resolves with the provider's message id once the provider ACCEPTED the message. */
  send(message: OutgoingEmail): Promise<{ id: string }>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export class EmailSendError extends Error {
  constructor(
    message: string,
    /** Transient failure (network, 429, 5xx) – worth retrying. */
    readonly retryable: boolean,
    /** Provider asked us to wait this long (rate limit). */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

/** Normalized provider lifecycle event (from a webhook or the mock simulator). */
export interface ProviderEmailEvent {
  messageId: string;
  type: 'sent' | 'delivered' | 'delivery_delayed' | 'bounced' | 'complained' | 'failed';
  at: Date;
  detail?: string;
}
