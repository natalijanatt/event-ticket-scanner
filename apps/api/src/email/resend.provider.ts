import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EmailSendError, type EmailProvider, type OutgoingEmail } from './email.types';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/**
 * Real delivery through the Resend REST API.
 * A 2xx response means Resend ACCEPTED the message – nothing more. Actual
 * delivery is reported later through the signed webhook.
 */
@Injectable()
export class ResendProvider implements EmailProvider {
  readonly name = 'resend' as const;

  constructor(private readonly config: AppConfig) {}

  async send(message: OutgoingEmail): Promise<{ id: string }> {
    let response: Response;
    try {
      response = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.config.emailFrom,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          attachments: message.attachments?.map((a) => ({
            filename: a.filename,
            content: a.content.toString('base64'),
            ...(a.contentId ? { content_id: a.contentId } : {}),
          })),
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new EmailSendError(`Mrežna greška pri slanju (${(err as Error).name}).`, true);
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!body?.id) throw new EmailSendError('Servis za slanje nije vratio ID poruke.', true);
      return { id: body.id };
    }

    const body = (await response.json().catch(() => null)) as { message?: string; name?: string } | null;
    // Provider messages can echo the recipient – keep only the error class for storage/logs.
    const reason = body?.name ?? `HTTP ${response.status}`;

    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new EmailSendError('Dostignut je limit slanja. Pokušaćemo ponovo.', true, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000);
    }
    // 409 = the idempotency key is still being processed by a concurrent request.
    if (response.status >= 500 || response.status === 409) {
      throw new EmailSendError(`Servis za slanje trenutno nije dostupan (${reason}).`, true);
    }
    throw new EmailSendError(`Servis za slanje je odbio poruku (${reason}).`, false);
  }
}
