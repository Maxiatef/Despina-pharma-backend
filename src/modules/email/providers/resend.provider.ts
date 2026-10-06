import { Injectable, NotImplementedException } from '@nestjs/common';
import { EmailProvider } from './email.provider.js';
import type { OutgoingEmail, SendResult } from './email.provider.js';

/**
 * ┌──────────────────────────────────────────────────────────────────┐
 * │ TODO(resend): NOT IMPLEMENTED YET – left empty on purpose.        │
 * │ Email sending will be connected with Resend later.                │
 * │                                                                   │
 * │   npm i resend                                                    │
 * │   const resend = new Resend(process.env.RESEND_API_KEY);          │
 * │   const { data, error } = await resend.emails.send({              │
 * │     from: process.env.EMAIL_FROM, to: email.to,                   │
 * │     subject: email.subject, text: email.text, html: email.html,   │
 * │     replyTo: email.replyTo,                                       │
 * │   });                                                             │
 * │   if (error) throw new Error(error.message);                      │
 * │   return { providerMessageId: data.id };                          │
 * │                                                                   │
 * │ Then in email.module.ts provide this class when                   │
 * │ EMAIL_PROVIDER=resend.                                            │
 * └──────────────────────────────────────────────────────────────────┘
 */
@Injectable()
export class ResendEmailProvider extends EmailProvider {
  readonly name = 'resend';

  async send(_email: OutgoingEmail): Promise<SendResult> {
    throw new NotImplementedException('Resend is not connected yet (TODO(resend))');
  }
}
