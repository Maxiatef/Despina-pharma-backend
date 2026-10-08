import type { EmailKind } from '../../common/enums.js';

export type TemplateName = 'owner_notice' | 'customer_ack' | 'staff_alert' | 'message_notice' | 'quote_notice' | 'invite' | 'password_reset';

export interface RenderedEmail {
  subject: string;
  text: string;
}

const FORM_LABELS: Record<string, string> = {
  contact: 'Contact message',
  new_customer: 'New customer profile',
  new_product: 'New product / quote request',
  sample_request: 'Sample request',
  sample_feedback: 'Sample feedback',
  service: 'Service inquiry',
};

/** Plain-text templates. Replace with branded HTML templates when Resend is added. */
export function renderTemplate(name: TemplateName, data: Record<string, any>, appUrl: string): RenderedEmail {
  switch (name) {
    case 'owner_notice':
      return {
        subject: `[${data.referenceNo}] ${FORM_LABELS[data.formType] ?? 'New inquiry'} – ${data.contactName}`,
        text: [
          `New ${FORM_LABELS[data.formType] ?? 'inquiry'} received.`,
          `Reference: ${data.referenceNo}`,
          `From: ${data.contactName} <${data.contactEmail}>`,
          data.companyName ? `Company: ${data.companyName}` : '',
          data.inquiryType ? `Inquiry type: ${data.inquiryType}` : '',
          data.followUpDue ? `Follow-up task due: ${new Date(data.followUpDue).toUTCString()}` : '',
          data.sourcePage ? `Page: ${data.sourcePage}` : '',
          '',
          data.message ?? '',
          '',
          `Open in dashboard: ${appUrl}/admin/inquiries/${data.inquiryId}`,
        ].filter((l) => l !== undefined).join('\n'),
      };
    case 'customer_ack':
      return {
        subject: `We received your request – ${data.referenceNo}`,
        text: [
          `Hello ${data.contactName},`,
          '',
          `Thank you for contacting Despina Pharma. We received your ${(FORM_LABELS[data.formType] ?? 'inquiry').toLowerCase()}.`,
          `Your reference number is ${data.referenceNo}. Please keep it for any follow-up.`,
          'A member of our team will reply soon.',
          '',
          'Despina Pharma',
        ].join('\n'),
      };
    case 'staff_alert':
      return { subject: `[Alert] ${data.title}`, text: data.body ?? '' };
    case 'message_notice':
      return {
        subject: `New message on ${data.projectCode ?? data.referenceNo ?? 'your project'}`,
        text: `${data.senderName ?? 'Someone'} wrote:\n\n${data.body}\n\n${appUrl}`,
      };
    case 'quote_notice':
      return { subject: `Quote ${data.quoteNo} is ready`, text: `A new quote is ready to review: ${appUrl}/portal/projects/${data.projectId}` };
    case 'invite':
      return {
        subject: 'You are invited to the Despina Pharma workspace',
        text: `Set your password to get started (link valid for 72 hours):\n${appUrl}/accept-invite?token=${data.token}`,
      };
    case 'password_reset':
      return {
        subject: 'Reset your Despina Pharma password',
        text: `Use this link within 2 hours to set a new password:\n${appUrl}/reset-password?token=${data.token}\n\nIf you did not ask for this, ignore this email.`,
      };
  }
}

export const templateKind = (name: TemplateName): EmailKind => name;
