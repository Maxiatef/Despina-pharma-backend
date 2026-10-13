/**
 * Every e-mail the system sends, and how an admin controls it in Admin → Settings → Emails.
 * Settings live in app_settings (see SettingsService); .env values are only the fallback.
 *
 *   email.sender_name / email.sender_email / email.reply_to   sender identity
 *   email.enabled                                               master switch ("false" = nothing is sent)
 *   notify.<key>.enabled  + notify.<key>.to                     staff notifications (to = comma-separated)
 *   customer.<key>.enabled                                      e-mails to customers
 * Unset switch = on. Only an explicit "false" turns an e-mail off.
 */

export type StaffNotificationKey =
  | 'inquiry.contact' | 'inquiry.new_product' | 'inquiry.new_customer' | 'inquiry.sample_request' | 'inquiry.sample_feedback'
  | 'customer.message' | 'quote.response' | 'approval.received' | 'sample.feedback'
  | 'lead.assigned' | 'task.assigned' | 'task.overdue' | 'email.failure';

export type CustomerEmailKey =
  | 'inquiry_ack' | 'reply' | 'info_request' | 'quote_ready' | 'quote_response_ack' | 'sample_shipped'
  | 'feedback_request' | 'document_ready' | 'approval_request' | 'stage_update';

export interface StaffNotificationDef {
  key: StaffNotificationKey;
  label: string;
  description: string;
  /** list = sent to the addresses set in Settings; person = sent to the staff member concerned (assignee / project owner) */
  recipients: 'list' | 'person' | 'list+person';
  /** .env fallback when no address is set in Settings */
  envFallback?: string;
}

export const STAFF_NOTIFICATIONS: StaffNotificationDef[] = [
  { key: 'inquiry.contact', label: 'New contact message', description: 'Someone sent the contact form (with its inquiry type).', recipients: 'list', envFallback: 'NOTIFY_CONTACT' },
  { key: 'inquiry.new_product', label: 'New product brief / service inquiry', description: 'Someone sent a product brief or asked about a service.', recipients: 'list', envFallback: 'NOTIFY_NEW_PRODUCT' },
  { key: 'inquiry.new_customer', label: 'New company profile', description: 'A brand introduced itself with the company profile form.', recipients: 'list', envFallback: 'NOTIFY_NEW_CUSTOMER' },
  { key: 'inquiry.sample_request', label: 'New sample request', description: 'Someone asked for a sample from the website.', recipients: 'list', envFallback: 'NOTIFY_SAMPLE_REQUEST' },
  { key: 'inquiry.sample_feedback', label: 'Sample feedback from the website', description: 'Someone sent the sample feedback form on the website.', recipients: 'list', envFallback: 'NOTIFY_SAMPLE_FEEDBACK' },
  { key: 'customer.message', label: 'Customer sent a message', description: 'A customer wrote a message in their project workspace. Goes to the project owner and the addresses below.', recipients: 'list+person' },
  { key: 'quote.response', label: 'Customer answered a quote', description: 'A customer accepted, asked for changes to, or declined a quote. Goes to the project owner and the addresses below.', recipients: 'list+person' },
  { key: 'approval.received', label: 'Customer approved something', description: 'A customer approved a sample, a document or a brief version. Goes to the project owner and the addresses below.', recipients: 'list+person' },
  { key: 'sample.feedback', label: 'Customer sent sample feedback', description: 'A customer rated a sample revision in the portal. Goes to the project owner and the addresses below.', recipients: 'list+person' },
  { key: 'lead.assigned', label: 'Lead assigned to you', description: 'Tells a staff member that a lead was assigned to them.', recipients: 'person' },
  { key: 'task.assigned', label: 'Task assigned to you', description: 'Tells a staff member that a task was assigned to them.', recipients: 'person' },
  { key: 'task.overdue', label: 'Daily overdue-task reminder', description: 'Each morning, every staff member with overdue tasks gets one list.', recipients: 'person' },
  { key: 'email.failure', label: 'An e-mail could not be sent', description: 'Sent when an e-mail still fails after all retries, or the address bounced.', recipients: 'list' },
];

export interface CustomerEmailDef {
  key: CustomerEmailKey;
  label: string;
  description: string;
}

export const CUSTOMER_EMAILS: CustomerEmailDef[] = [
  { key: 'inquiry_ack', label: 'Confirmation after a website form', description: 'Thank-you e-mail with the reference number, sent to whoever filled in a form.' },
  { key: 'reply', label: 'Replies and messages from the team', description: 'A reply to a lead, or a team message in the project workspace.' },
  { key: 'info_request', label: 'More information needed', description: 'Sent when staff reply with "Ask the customer for more information" ticked.' },
  { key: 'quote_ready', label: 'Quote ready to review', description: 'Sent when staff send a quote (or a new version) to the customer.' },
  { key: 'quote_response_ack', label: 'Quote answer confirmation', description: 'Confirms to the customer that their acceptance, change request or decline was received.' },
  { key: 'sample_shipped', label: 'Sample shipped', description: 'Sent when a sample revision is marked as shipped (with the tracking number).' },
  { key: 'feedback_request', label: 'Sample feedback request', description: 'Sent when staff click "Ask for feedback" on a sample revision.' },
  { key: 'document_ready', label: 'New document available', description: 'Sent when a customer-visible document (or a new version) is ready to download.' },
  { key: 'approval_request', label: 'Approval requested', description: 'Sent when staff click "Request approval" on a document.' },
  { key: 'stage_update', label: 'Project stage update', description: 'Sent when a project (or one of its products) moves to its next stage.' },
];

/** Account e-mails are always sent – they are needed to sign in. */
export const ACCOUNT_EMAILS = [
  { key: 'invite', label: 'Workspace invitation', description: 'Link to set a password (valid 72 hours).' },
  { key: 'password_reset', label: 'Password reset', description: 'Link to choose a new password (valid 2 hours).' },
];

export const SETTING_KEYS = {
  senderName: 'email.sender_name',
  senderEmail: 'email.sender_email',
  replyTo: 'email.reply_to',
  enabled: 'email.enabled',
  notifyEnabled: (k: string) => `notify.${k}.enabled`,
  notifyTo: (k: string) => `notify.${k}.to`,
  customerEnabled: (k: string) => `customer.${k}.enabled`,
};

/** Every key the e-mail settings page may write. */
export const EMAIL_SETTING_KEYS = new Set<string>([
  SETTING_KEYS.senderName, SETTING_KEYS.senderEmail, SETTING_KEYS.replyTo, SETTING_KEYS.enabled,
  ...STAFF_NOTIFICATIONS.flatMap((n) => [SETTING_KEYS.notifyEnabled(n.key), SETTING_KEYS.notifyTo(n.key)]),
  ...CUSTOMER_EMAILS.map((c) => SETTING_KEYS.customerEnabled(c.key)),
]);

const EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** "a@x.com, b@y.com" → ['a@x.com', 'b@y.com'] (invalid entries dropped). */
export function parseRecipients(value: string | null | undefined): string[] {
  return [...new Set((value ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s)))];
}

export function isValidEmail(value: string) {
  return EMAIL_RE.test(value.trim());
}

/** Test data never leaves the system (smoke tests use @smoke-test.invalid / @qa.invalid, RFC 2606 names). */
export function isUndeliverableTestAddress(email: string) {
  return /@([a-z0-9-]+\.)*(invalid|test|example|localhost)$/i.test(email.trim()) || /@example\.(com|org|net)$/i.test(email.trim());
}
