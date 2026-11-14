import { Injectable } from '@nestjs/common';
import { createTransport, type SendMailOptions, type Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { AppConfig } from '../config/app-config';
import { EmailSendError, type EmailProvider, type OutgoingEmail } from './email.types';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SEND_ENDPOINT = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/** Connection-level failures – the message never reached Gmail, so a retry is safe. */
const RETRYABLE_CODES = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNRESET', 'EPROTOCOL']);

/**
 * Delivery from a Gmail account. Two transports, picked by configuration:
 *  • Gmail API over HTTPS (GMAIL_CLIENT_ID / _SECRET / _REFRESH_TOKEN) – works
 *    on hosts that block outbound SMTP (e.g. Railway below the Pro plan);
 *  • SMTP with an app password (EMAIL_APP_PASSWORD).
 * Gmail has no delivery webhooks: a resolved send means Gmail ACCEPTED the
 * message, and the status stays there. Bounces arrive in the sender's inbox.
 */
@Injectable()
export class GmailProvider implements EmailProvider {
  readonly name = 'gmail' as const;
  private readonly smtp: Transporter | null;
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(private readonly config: AppConfig) {
    this.smtp = config.gmailRefreshToken
      ? null
      : createTransport({
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

  send(message: OutgoingEmail): Promise<{ id: string }> {
    const mail: SendMailOptions = {
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
    };
    return this.smtp ? this.sendViaSmtp(this.smtp, mail) : this.sendViaApi(mail);
  }

  // ── Gmail API ─────────────────────────────────────────────────────────────

  private async sendViaApi(mail: SendMailOptions): Promise<{ id: string }> {
    const raw = (await new MailComposer(mail).compile().build()).toString('base64url');

    let response = await this.postMessage(raw, await this.getAccessToken());
    if (response.status === 401) {
      // The cached token was revoked or expired early – get a fresh one once.
      this.accessToken = null;
      response = await this.postMessage(raw, await this.getAccessToken());
    }

    if (response.ok) {
      const body = (await response.json().catch(() => null)) as { id?: string } | null;
      if (!body?.id) throw new EmailSendError('Gmail nije vratio ID poruke.', true);
      return { id: body.id };
    }

    const body = (await response.json().catch(() => null)) as { error?: { status?: string; errors?: { reason?: string }[] } } | null;
    // Error messages can echo the recipient – keep only the error class for storage/logs.
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? `HTTP ${response.status}`;
    const rateLimited = response.status === 429 || (response.status === 403 && /ratelimit/i.test(reason));
    if (rateLimited) throw new EmailSendError('Dostignut je limit slanja. Pokušaćemo ponovo.', true, 5000);
    if (response.status >= 500) throw new EmailSendError(`Gmail trenutno nije dostupan (${reason}).`, true);
    throw new EmailSendError(`Gmail je odbio poruku (${reason}).`, false);
  }

  private async postMessage(raw: string, token: string): Promise<Response> {
    try {
      return await fetch(SEND_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      throw new EmailSendError(`Mrežna greška pri slanju (${(err as Error).name}).`, true);
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;

    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.config.gmailClientId,
          client_secret: this.config.gmailClientSecret,
          refresh_token: this.config.gmailRefreshToken,
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new EmailSendError(`Mrežna greška pri prijavi na Gmail (${(err as Error).name}).`, true);
    }

    const body = (await response.json().catch(() => null)) as { access_token?: string; expires_in?: number; error?: string } | null;
    if (response.ok && body?.access_token) {
      this.accessToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
      return body.access_token;
    }
    if (response.status >= 500) throw new EmailSendError('Google prijava trenutno nije dostupna.', true);
    throw new EmailSendError(`Google je odbio pristup Gmail nalogu (${body?.error ?? `HTTP ${response.status}`}). Obnovi GMAIL_REFRESH_TOKEN.`, false);
  }

  // ── SMTP ──────────────────────────────────────────────────────────────────

  private async sendViaSmtp(smtp: Transporter, mail: SendMailOptions): Promise<{ id: string }> {
    try {
      const info = await smtp.sendMail(mail);
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
