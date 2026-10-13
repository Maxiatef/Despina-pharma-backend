import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailEvent, EmailJob } from '../../database/entities/index.js';
import { EmailService } from './email.service.js';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EmailProvider, NoopEmailProvider } from './providers/email.provider.js';
import { ResendEmailProvider } from './providers/resend.provider.js';
import { EmailSettingsController } from './email-settings.controller.js';
import { EmailFlushInterceptor } from './email-flush.interceptor.js';
import { EmailJobsController } from './email-jobs.controller.js';
import { EmailWebhookController } from './email-webhook.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EmailJob, EmailEvent])],
  providers: [
    EmailService,
    // EMAIL_PROVIDER=resend sends through Resend; anything else logs only (e-mails stay queued).
    { provide: EmailProvider, useClass: process.env.EMAIL_PROVIDER === 'resend' ? ResendEmailProvider : NoopEmailProvider },
    // Sends what a request queued right after it succeeded.
    { provide: APP_INTERCEPTOR, useClass: EmailFlushInterceptor },
  ],
  controllers: [EmailJobsController, EmailWebhookController, EmailSettingsController],
  exports: [EmailService],
})
export class EmailModule {}
