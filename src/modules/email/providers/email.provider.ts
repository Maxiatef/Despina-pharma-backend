import { Injectable, Logger } from '@nestjs/common';

export interface OutgoingEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
  replyTo?: string;
  tags?: { name: string; value: string }[];
}

export interface SendResult {
  providerMessageId: string | null;
}

/** Contract every e-mail provider implements. EMAIL_PROVIDER=resend → ResendEmailProvider, none → NoopEmailProvider. */
export abstract class EmailProvider {
  abstract readonly name: string;
  abstract send(email: OutgoingEmail): Promise<SendResult>;
}

/** EMAIL_PROVIDER=none: logs the e-mail and sends nothing (jobs stay queued). */
@Injectable()
export class NoopEmailProvider extends EmailProvider {
  readonly name = 'none';
  private readonly logger = new Logger('Email');

  async send(email: OutgoingEmail): Promise<SendResult> {
    this.logger.warn(`[EMAIL NOT SENT – EMAIL_PROVIDER=none] to=${email.to} subject="${email.subject}"`);
    return { providerMessageId: null };
  }
}
