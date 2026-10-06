import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailEvent, EmailJob } from '../../database/entities/index.js';
import { EmailService } from './email.service.js';
import { EmailProvider, NoopEmailProvider } from './providers/email.provider.js';
import { EmailJobsController } from './email-jobs.controller.js';
import { EmailWebhookController } from './email-webhook.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([EmailJob, EmailEvent])],
  providers: [
    EmailService,
    // TODO(resend): when EMAIL_PROVIDER=resend, provide ResendEmailProvider here instead.
    { provide: EmailProvider, useClass: NoopEmailProvider },
  ],
  controllers: [EmailJobsController, EmailWebhookController],
  exports: [EmailService],
})
export class EmailModule {}
