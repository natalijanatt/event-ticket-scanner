import { Controller, Delete, Get, Header, Inject, Param } from '@nestjs/common';
import type { MailboxMessageDto } from '@event-platform/shared';
import { AdminOnly } from '../auth/decorators';
import { notFound } from '../common/errors';
import { AppConfig } from '../config/app-config';
import { EMAIL_PROVIDER, type EmailProvider } from './email.types';
import { MockEmailProvider } from './mock.provider';

/**
 * Development mailbox: lists the e-mails captured by the mock provider.
 * Exists only when EMAIL_MODE=mock and never in production – captured
 * messages contain live ticket links.
 */
@AdminOnly()
@Controller('dev/mailbox')
export class MailboxController {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly provider: EmailProvider,
    private readonly config: AppConfig,
  ) {}

  @Get()
  list(): MailboxMessageDto[] {
    return this.mock().list().map(({ id, to, subject, createdAt }) => ({ id, to, subject, createdAt }));
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string): { id: string; to: string; subject: string; html: string; createdAt: string } {
    const message = this.mock().get(id);
    if (!message) throw notFound('Poruka nije pronađena.');
    const { text: _text, ...rest } = message;
    return rest;
  }

  @Delete()
  clear(): { ok: true } {
    this.mock().clear();
    return { ok: true };
  }

  private mock(): MockEmailProvider {
    if (this.config.isProduction || !(this.provider instanceof MockEmailProvider)) throw notFound();
    return this.provider;
  }
}
