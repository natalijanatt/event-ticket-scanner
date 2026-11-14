import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_PROVIDER, type EmailProvider, type OutgoingEmail } from './email.types';
import { renderPasswordReset } from './templates/password-reset.template';

/** Thin facade over the configured provider (mock, Resend or Gmail). */
@Injectable()
export class EmailService {
  constructor(@Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider) {}

  get providerName(): EmailProvider['name'] {
    return this.provider.name;
  }

  send(message: OutgoingEmail): Promise<{ id: string }> {
    return this.provider.send(message);
  }

  async sendPasswordReset(input: { to: string; firstName: string; resetUrl: string }): Promise<void> {
    const rendered = renderPasswordReset(input);
    await this.provider.send({ to: input.to, ...rendered, idempotencyKey: `pwreset-${randomUUID()}` });
  }
}
