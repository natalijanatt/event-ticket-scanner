import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { AppConfig } from '../config/app-config';
import { EmailSendError, type EmailProvider, type OutgoingEmail } from './email.types';

/** Connection-level failures – the message never reached Gmail, so a retry is safe. */
const RETRYABLE_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'EPROTOCOL']);

/**
 * Delivery through Gmail's SMTP server, authenticated with an app password.
 * Gmail has no delivery webhooks: a resolved send means Gmail ACCEPTED the
 * message, and the status stays there. Bounces arrive in the sender's inbox.
 */
@Injectable()
export class GmailProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  private readonly transport: Transporter;

  constructor(private readonly config: AppConfig) {
    this.transport = createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      pool: true,
      maxConnections: 2,
      auth: { user: config.emailFromAddress, pass: config.emailAppPassword },
      connectionTimeout: 20_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: OutgoingEmail): Promise<{ id: string }> {
    try {
      const info = await this.transport.sendMail({
        from: this.config.emailFrom,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.content,
          ...(a.contentId ? { cid: a.contentId } : {}),
        })),
      });
      return { id: info.messageId };
    } catch (err) {
      const e = err as { code?: string; responseCode?: number };
      // Server replies can echo the recipient – keep only the error class for storage/logs.
      const reason = e.responseCode ? `SMTP ${e.responseCode}` : (e.code ?? 'nepoznata greška');
      if (e.code === 'EAUTH') {
        throw new EmailSendError('Gmail je odbio prijavu. Proveri lozinku za aplikaciju.', false);
      }
      const transient = e.responseCode ? e.responseCode >= 400 && e.responseCode < 500 : RETRYABLE_CODES.has(e.code ?? '');
      if (transient) throw new EmailSendError(`Gmail trenutno nije dostupan (${reason}).`, true);
      throw new EmailSendError(`Gmail je odbio poruku (${reason}).`, false);
    }
  }
}
