import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './email.types';
import { GmailProvider } from './gmail.provider';
import { MailboxController } from './mailbox.controller';
import { MockEmailProvider } from './mock.provider';
import { ResendProvider } from './resend.provider';

/**
 * The configuration boundary for e-mail: EMAIL_MODE picks the provider and
 * nothing outside this module knows which one is active.
 */
@Global()
@Module({
  controllers: [MailboxController],
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.emailMode === 'resend'
          ? new ResendProvider(config)
          : config.emailMode === 'gmail'
            ? new GmailProvider(config)
            : new MockEmailProvider(config),
    },
    EmailService,
  ],
  exports: [EMAIL_PROVIDER, EmailService],
})
export class EmailModule {}
