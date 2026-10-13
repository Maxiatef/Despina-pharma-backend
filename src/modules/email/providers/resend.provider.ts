import { Injectable } from '@nestjs/common';
import { Resend } from 'resend';
import { EmailProvider } from './email.provider.js';
import type { OutgoingEmail, SendResult } from './email.provider.js';

/**
 * Sends through Resend (same SDK and approach as cocojojochem's EmailService).
 * Resend RESOLVES on an API error and returns it in `error` – it is re-thrown here so a rejected e-mail
 * is never recorded as sent.
 *
 * The sender domain must be verified in the Resend account (SPF + DKIM). Until then use
 * onboarding@resend.dev, which only delivers to the Resend account owner's own address.
 */
@Injectable()
export class ResendEmailProvider extends EmailProvider {
  readonly name = 'resend';
  private client: Resend | null = null;

  private get resend() {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error('RESEND_API_KEY is not set');
    this.client ??= new Resend(key);
    return this.client;
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const { data, error } = await this.resend.emails.send({
      from: email.from,
      to: [email.to],
      subject: email.subject,
      html: email.html ?? undefined,
      text: email.text,
      replyTo: email.replyTo || undefined,
      tags: email.tags?.map((t) => ({ name: t.name, value: t.value.replace(/[^\w-]/g, '_').slice(0, 256) })),
    });
    if (error) throw new Error(`${error.name || 'ResendError'}: ${error.message || 'unknown error'}`);
    return { providerMessageId: data?.id ?? null };
  }
}
