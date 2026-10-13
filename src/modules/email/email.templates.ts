/**
 * Despina Pharma e-mail templates: one branded HTML layout (table-based, inline styles – works in Gmail,
 * Outlook, Apple Mail) + a plain-text version of the same content. Every value is HTML-escaped.
 *
 * Brand: navy #112a46, cyan #0ec4df (the site's logo mark), serif headings like the website.
 */
export type TemplateName =
  | 'owner_notice' | 'customer_ack' | 'lead_assigned' | 'task_assigned' | 'overdue_digest'
  | 'message_to_customer' | 'message_to_staff' | 'info_request'
  | 'quote_ready' | 'quote_response_staff' | 'quote_response_ack' | 'approval_staff' | 'sample_feedback_staff'
  | 'sample_shipped' | 'feedback_request' | 'document_ready' | 'approval_request' | 'stage_update'
  | 'invite' | 'password_reset' | 'failure_alert' | 'staff_alert' | 'test';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

type Data = Record<string, any>;

interface Content {
  subject: string;
  /** Short line shown next to the subject in the inbox. */
  preheader: string;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  details?: [label: string, value: unknown][];
  /** A message, note or question shown in a quote box. */
  quote?: string | null;
  list?: string[];
  cta?: { label: string; url: string };
  after?: string[];
  /** Why the reader gets this e-mail (footer). */
  reason: string;
}

const BRAND = {
  name: 'Despina Pharma',
  tagline: 'The art of beauty. The science behind it.',
  about: 'Formulation, manufacturing and packaging for considered beauty and personal care.',
  navy: '#112a46',
  cyan: '#0ec4df',
  ink: '#1d2939',
  muted: '#667085',
  line: '#e4e7ec',
  bg: '#f4f6f9',
};

const FORM_LABELS: Record<string, string> = {
  contact: 'contact message',
  new_customer: 'company profile',
  new_product: 'product brief',
  sample_request: 'sample request',
  sample_feedback: 'sample feedback',
  service: 'service inquiry',
};

export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const fmtDate = (v: unknown) => {
  if (!v) return '';
  const d = new Date(String(v));
  return Number.isNaN(+d) ? String(v) : d.toUTCString().replace(' GMT', ' UTC');
};

const money = (amount: unknown, currency: unknown) => {
  const n = Number(amount);
  if (Number.isNaN(n)) return String(amount ?? '');
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: String(currency || 'USD') }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ''}`.trim();
  }
};

const name = (d: Data) => d.contactName || d.name || '';
const hello = (d: Data) => (name(d) ? `Hello ${String(name(d)).split(' ')[0]},` : 'Hello,');

function content(t: TemplateName, raw: Data, app: string): Content {
  // Readable fallbacks so an e-mail never shows "undefined".
  const d: Data = { senderName: 'A customer', customerEmail: 'The customer', what: 'an item', subject: '(no subject)', toEmail: 'unknown address', ...raw };
  const lead = `${app}/admin/inquiries/${d.inquiryId ?? ''}/`;
  const staffProject = `${app}/admin/projects/${d.projectId ?? ''}/`;
  const portalProject = `${app}/portal/projects/${d.projectId ?? ''}/`;
  const ref = d.referenceNo ?? d.projectCode ?? '';
  switch (t) {
    // ------------------------------------------------------------------ staff
    case 'owner_notice': {
      const form = FORM_LABELS[d.formType] ?? 'inquiry';
      return {
        subject: `[${d.referenceNo}] New ${form} – ${name(d) || d.contactEmail}${d.companyName ? ` · ${d.companyName}` : ''}`,
        preheader: d.inquiryType ? `${d.inquiryType} · ${d.contactEmail}` : `From ${d.contactEmail}`,
        eyebrow: 'New website request',
        title: `New ${form} ${d.referenceNo}`,
        paragraphs: [`${name(d) || d.contactEmail} sent the ${form} form on the website. A follow-up task was created in the dashboard.`],
        details: [
          ['Reference', d.referenceNo],
          ['Inquiry type', d.inquiryType],
          ['From', `${name(d)} <${d.contactEmail}>`],
          ['Phone', d.phone],
          ['Company', d.companyName],
          ['Products / services', (d.items ?? []).filter(Boolean).join(', ')],
          ['Sent from page', d.sourcePage],
          ['Follow-up due', fmtDate(d.followUpDue)],
          ['Assigned to', d.assignedTo],
        ],
        quote: d.message,
        list: (d.answers ?? []).map((a: [string, string]) => `${a[0]}: ${a[1]}`),
        cta: { label: 'Open the lead', url: lead },
        reason: 'You get this because your address is set for this notification in Admin → Settings → Emails.',
      };
    }
    case 'lead_assigned':
      return {
        subject: `Lead ${d.referenceNo} assigned to you`,
        preheader: `${name(d)}${d.companyName ? ` · ${d.companyName}` : ''}`,
        eyebrow: 'Lead assigned',
        title: `${d.referenceNo} is yours`,
        paragraphs: [`${d.assignedBy ?? 'A colleague'} assigned this lead to you.${d.taskCount ? ` Its open follow-up task${d.taskCount > 1 ? 's were' : ' was'} assigned to you too.` : ''}`],
        details: [['Reference', d.referenceNo], ['Contact', name(d)], ['Company', d.companyName], ['Status', d.status]],
        cta: { label: 'Open the lead', url: lead },
        reason: 'You get this because a lead was assigned to you.',
      };
    case 'task_assigned':
      return {
        subject: `Task assigned to you: ${d.title}`,
        preheader: d.dueAt ? `Due ${fmtDate(d.dueAt)}` : 'No due date',
        eyebrow: 'Task assigned',
        title: d.title,
        paragraphs: [`${d.assignedBy ?? 'A colleague'} assigned this task to you.`],
        details: [['For', d.forRef], ['Due', fmtDate(d.dueAt)], ['Priority', d.priority]],
        cta: { label: 'Open', url: `${app}${d.path ?? '/admin/tasks/'}` },
        reason: 'You get this because a task was assigned to you.',
      };
    case 'overdue_digest':
      return {
        subject: `${(d.tasks ?? []).length} overdue follow-up task${(d.tasks ?? []).length === 1 ? '' : 's'}`,
        preheader: 'Your follow-ups that are past their due date',
        eyebrow: 'Daily reminder',
        title: 'These follow-ups are overdue',
        paragraphs: ['The tasks below are assigned to you and past their due date.'],
        list: d.tasks ?? [],
        cta: { label: 'Open my tasks', url: `${app}/admin/tasks/?assignee=me&state=overdue` },
        reason: 'Daily reminder for staff with overdue tasks (Admin → Settings → Emails).',
      };
    case 'message_to_staff':
      return {
        subject: `New message from ${d.senderName} on ${d.projectCode}`,
        preheader: String(d.body ?? '').slice(0, 90),
        eyebrow: 'Customer message',
        title: `Message on ${d.projectCode}`,
        paragraphs: [`${d.senderName} wrote in the project workspace${d.projectName ? ` "${d.projectName}"` : ''}:`],
        quote: d.body,
        cta: { label: 'Reply in the dashboard', url: staffProject },
        reason: 'You get this as the project owner or because your address is set for customer messages.',
      };
    case 'quote_response_staff': {
      const what = d.decision === 'accepted' ? 'accepted' : d.decision === 'declined' ? 'declined' : 'asked for changes to';
      return {
        subject: `Customer ${what} quote ${d.quoteNo}`,
        preheader: d.note ? String(d.note).slice(0, 90) : `${d.projectCode} · version ${d.versionNo}`,
        eyebrow: 'Quote answer',
        title: `Quote ${d.quoteNo} ${d.decision === 'changes_requested' ? 'needs changes' : d.decision}`,
        paragraphs: [`${d.customerEmail} ${what} version ${d.versionNo} of quote ${d.quoteNo}.${d.decision === 'changes_requested' ? ' A "Revise quote" task was created.' : ''}`],
        details: [['Project', `${d.projectCode} – ${d.projectName}`], ['Quote', `${d.quoteNo} v${d.versionNo}`], ['Total', d.total ? money(d.total, d.currency) : '']],
        quote: d.note,
        cta: { label: 'Open the project', url: staffProject },
        reason: 'You get this as the project owner or because your address is set for quote answers.',
      };
    }
    case 'approval_staff':
      return {
        subject: `Approved: ${d.what} – ${d.projectCode}`,
        preheader: `“${String(d.confirmationText ?? '').slice(0, 80)}”`,
        eyebrow: 'Customer approval',
        title: `${d.customerEmail} approved ${d.what}`,
        paragraphs: ['The approval is tied to this exact version and stored with its fingerprint.'],
        details: [['Project', `${d.projectCode} – ${d.projectName}`], ['Approved', d.what], ['Confirmation', d.confirmationText]],
        cta: { label: 'Open the project', url: staffProject },
        reason: 'You get this as the project owner or because your address is set for approvals.',
      };
    case 'sample_feedback_staff':
      return {
        subject: `Sample feedback (${d.rating ?? '–'}/5): ${d.sampleTitle}`,
        preheader: String(d.comments ?? '').slice(0, 90),
        eyebrow: 'Sample feedback',
        title: `Feedback on ${d.sampleTitle}, revision ${d.revisionNo}`,
        paragraphs: [`${d.customerEmail} reviewed the sample.`],
        details: [['Project', `${d.projectCode} – ${d.projectName}`], ['Rating', d.rating ? `${d.rating} / 5` : ''], ['Product', d.productName]],
        quote: d.comments,
        cta: { label: 'Open the project', url: staffProject },
        reason: 'You get this as the project owner or because your address is set for sample feedback.',
      };
    case 'failure_alert':
      return {
        subject: `E-mail not delivered: ${d.subject}`,
        preheader: `To ${d.toEmail}: ${String(d.error ?? '').slice(0, 80)}`,
        eyebrow: 'Delivery problem',
        title: 'An e-mail could not be delivered',
        paragraphs: ['Check the address, then retry it from the e-mail log.'],
        details: [['To', d.toEmail], ['Subject', d.subject], ['Problem', d.error], ['Attempts', d.attempts]],
        cta: { label: 'Open the e-mail log', url: `${app}/admin/emails/` },
        reason: 'You get this because your address is set for delivery problems in Admin → Settings → Emails.',
      };
    case 'staff_alert':
      return {
        subject: d.title,
        preheader: String(d.body ?? '').slice(0, 90),
        eyebrow: 'Notification',
        title: d.title,
        paragraphs: String(d.body ?? '').split('\n').filter(Boolean),
        reason: 'Despina Pharma staff notification.',
      };
    // ------------------------------------------------------------------ customers
    case 'customer_ack': {
      const form = FORM_LABELS[d.formType] ?? 'request';
      return {
        subject: `We received your ${form} – ${d.referenceNo}`,
        preheader: `Your reference number is ${d.referenceNo}.`,
        eyebrow: 'Thank you',
        title: 'We have your details.',
        paragraphs: [
          hello(d),
          `Thank you for contacting ${BRAND.name}. We received your ${form} and a member of our team will reply soon.`,
          'Please keep your reference number for any follow-up.',
        ],
        details: [['Reference number', d.referenceNo], ['Topic', d.inquiryType], ['Received', fmtDate(d.receivedAt ?? new Date())]],
        cta: { label: 'Explore the product library', url: `${app}/products/` },
        after: ['If you need to add something, simply reply to this e-mail and mention your reference number.'],
        reason: 'You get this because you sent a form on the Despina Pharma website.',
      };
    }
    case 'message_to_customer':
      return {
        subject: `New message from ${BRAND.name}${ref ? ` – ${ref}` : ''}`,
        preheader: String(d.body ?? '').slice(0, 90),
        eyebrow: 'Message',
        title: 'You have a new message',
        paragraphs: [hello(d), `${d.senderName ?? 'Our team'} wrote${ref ? ` about ${ref}` : ''}:`],
        quote: d.body,
        cta: d.projectId ? { label: 'Reply in your workspace', url: portalProject } : undefined,
        after: d.projectId ? [] : ['You can reply directly to this e-mail.'],
        reason: 'You get this because you are in contact with Despina Pharma about this request.',
      };
    case 'info_request':
      return {
        subject: `We need a little more information – ${d.referenceNo}`,
        preheader: String(d.body ?? '').slice(0, 90),
        eyebrow: 'Your request',
        title: 'A few more details, please',
        paragraphs: [hello(d), `To move your request ${d.referenceNo} forward, we need some more information:`],
        quote: d.body,
        after: ['Simply reply to this e-mail with your answer. Thank you!'],
        reason: 'You get this because you sent a request to Despina Pharma.',
      };
    case 'quote_ready':
      return {
        subject: `Your quote ${d.quoteNo} is ready`,
        preheader: `${d.projectName} · ${d.total ? money(d.total, d.currency) : ''}`,
        eyebrow: 'Quotation',
        title: `Quote ${d.quoteNo} is ready to review`,
        paragraphs: [hello(d), `Your quote for ${d.projectName} is ready${d.versionNo > 1 ? ` (version ${d.versionNo})` : ''}. You can accept it, ask for changes or decline it in your workspace.`],
        details: [['Project', d.projectName], ['Quote', `${d.quoteNo} v${d.versionNo ?? 1}`], ['Total', d.total ? money(d.total, d.currency) : ''], ['Valid until', d.validUntil]],
        cta: { label: 'Review the quote', url: portalProject },
        reason: 'You get this because you have a project workspace with Despina Pharma.',
      };
    case 'quote_response_ack': {
      const lines: Record<string, [string, string]> = {
        accepted: ['Thank you – your quote is accepted', `We recorded your acceptance of quote ${d.quoteNo} (version ${d.versionNo}). Your Despina contact will be in touch about the next steps.`],
        changes_requested: ['We received your change request', `Thank you. We received your requested changes to quote ${d.quoteNo}. We will send you a revised version.`],
        declined: ['Your answer was received', `We recorded that you declined quote ${d.quoteNo}. Thank you for letting us know – your Despina contact may follow up.`],
      };
      const [title, line] = lines[d.decision] ?? lines.changes_requested;
      return {
        subject: `${title} – ${d.quoteNo}`,
        preheader: line.slice(0, 90),
        eyebrow: 'Quotation',
        title,
        paragraphs: [hello(d), line],
        quote: d.note,
        cta: { label: 'Open your workspace', url: portalProject },
        reason: 'You get this because you answered a quote in your Despina Pharma workspace.',
      };
    }
    case 'sample_shipped':
      return {
        subject: `Your sample is on its way – ${d.sampleTitle}`,
        preheader: d.trackingNo ? `Tracking number ${d.trackingNo}` : `${d.productName} · revision ${d.revisionNo}`,
        eyebrow: 'Sample shipped',
        title: 'Your sample is on its way',
        paragraphs: [hello(d), `We shipped ${d.sampleTitle} (revision ${d.revisionNo}) for ${d.productName}.`],
        details: [['Project', d.projectName], ['Sample', `${d.sampleTitle} · revision ${d.revisionNo}`], ['Tracking number', d.trackingNo], ['Shipped', fmtDate(d.shippedAt)]],
        quote: d.description,
        cta: { label: 'Open your workspace', url: portalProject },
        after: ['When it arrives, you can record your feedback on this exact revision in your workspace.'],
        reason: 'You get this because you have a project workspace with Despina Pharma.',
      };
    case 'feedback_request':
      return {
        subject: `How did ${d.sampleTitle} perform?`,
        preheader: 'Your feedback shapes the next revision.',
        eyebrow: 'Sample feedback',
        title: 'Tell us what you think',
        paragraphs: [hello(d), `We would love your feedback on ${d.sampleTitle} (revision ${d.revisionNo}) for ${d.productName}: appearance, texture, scent, application and after-feel.`],
        cta: { label: 'Give feedback', url: portalProject },
        reason: 'You get this because you received a sample from Despina Pharma.',
      };
    case 'document_ready':
      return {
        subject: `New document: ${d.title}`,
        preheader: `${d.projectName}${d.versionNo > 1 ? ` · version ${d.versionNo}` : ''}`,
        eyebrow: 'Documents',
        title: d.versionNo > 1 ? `A new version of ${d.title} is ready` : `${d.title} is ready`,
        paragraphs: [hello(d), `A document for ${d.projectName} is ready to view and download in your workspace.`],
        details: [['Document', d.title], ['Version', d.versionNo], ['File', d.filename]],
        cta: { label: 'Open your workspace', url: portalProject },
        reason: 'You get this because you have a project workspace with Despina Pharma.',
      };
    case 'approval_request':
      return {
        subject: `Please review and approve: ${d.title}`,
        preheader: `${d.projectName} · version ${d.versionNo}`,
        eyebrow: 'Approval needed',
        title: 'Your approval is needed',
        paragraphs: [hello(d), `Please review ${d.title} (version ${d.versionNo}) for ${d.projectName}. Your approval applies to this exact version only.`],
        quote: d.note,
        cta: { label: 'Review and approve', url: portalProject },
        reason: 'You get this because you have a project workspace with Despina Pharma.',
      };
    case 'stage_update':
      return {
        subject: `${d.projectCode}: ${d.nextStage ? `now in ${d.nextStage}` : 'all stages completed'}`,
        preheader: `${d.completedStage} completed${d.productName ? ` for ${d.productName}` : ''}`,
        eyebrow: 'Project update',
        title: d.nextStage ? `Next stage: ${d.nextStage}` : 'All stages completed',
        paragraphs: [hello(d), `“${d.completedStage}” is completed${d.productName ? ` for ${d.productName}` : ''} in ${d.projectName}.${d.nextStage ? ` The next stage is “${d.nextStage}”.` : ''}`],
        details: [['Project', `${d.projectCode} – ${d.projectName}`], ['Product', d.productName], ['Completed', d.completedStage], ['Next', d.nextStage]],
        cta: { label: 'See your project', url: portalProject },
        reason: 'You get this because you have a project workspace with Despina Pharma.',
      };
    // ------------------------------------------------------------------ account
    case 'invite':
      return {
        subject: `You're invited to the ${BRAND.name} workspace`,
        preheader: 'Set your password to get started (link valid for 72 hours).',
        eyebrow: 'Welcome',
        title: 'Your project workspace is ready',
        paragraphs: [`You have been invited to the ${BRAND.name} ${d.role === 'customer' ? 'project workspace, where you can follow your projects, samples, quotes and documents' : 'team dashboard'}.`, 'Set your password to get started. The link is valid for 72 hours and works once.'],
        cta: { label: 'Set my password', url: `${app}/accept-invite/?token=${encodeURIComponent(d.token)}` },
        after: ['If you did not expect this invitation, you can ignore this e-mail.'],
        reason: 'You get this because Despina Pharma invited this address.',
      };
    case 'password_reset':
      return {
        subject: `Reset your ${BRAND.name} password`,
        preheader: 'This link is valid for 2 hours.',
        eyebrow: 'Account',
        title: 'Choose a new password',
        paragraphs: ['We received a request to reset the password of your account. The link is valid for 2 hours and works once.'],
        cta: { label: 'Reset my password', url: `${app}/reset-password/?token=${encodeURIComponent(d.token)}` },
        after: ['If you did not ask for this, ignore this e-mail – your password stays the same.'],
        reason: 'You get this because a password reset was requested for this address.',
      };
    case 'test':
      return {
        subject: `Test e-mail from ${BRAND.name}`,
        preheader: 'E-mail sending works.',
        eyebrow: 'Test',
        title: 'E-mail sending works',
        paragraphs: [`This test was sent by ${d.requestedBy ?? 'an admin'} from Admin → Settings → Emails.`],
        details: [['Sender', d.sender], ['Sent', fmtDate(new Date())]],
        cta: { label: 'Open the dashboard', url: `${app}/admin/` },
        reason: 'Test e-mail.',
      };
  }
}

// ------------------------------------------------------------------ layout
function html(c: Content, app: string) {
  const p = (t: string) => `<p style="margin:0 0 14px;font:15px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(t)}</p>`;
  const details = (c.details ?? []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  const rows = details
    .map(([k, v]) => `<tr><td style="padding:8px 12px 8px 0;font:13px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.muted};white-space:nowrap;vertical-align:top;border-top:1px solid ${BRAND.line}">${esc(k)}</td><td style="padding:8px 0;font:14px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink};border-top:1px solid ${BRAND.line}">${esc(v)}</td></tr>`)
    .join('');
  const quote = c.quote
    ? `<div style="margin:4px 0 18px;padding:14px 16px;background:#f0fbfd;border-left:3px solid ${BRAND.cyan};font:14px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.ink};white-space:pre-line">${esc(c.quote)}</div>`
    : '';
  const list = c.list?.length
    ? `<ul style="margin:0 0 18px;padding-left:18px">${c.list.map((i) => `<li style="margin:0 0 6px;font:14px/1.5 Arial,Helvetica,sans-serif;color:${BRAND.ink}">${esc(i)}</li>`).join('')}</ul>`
    : '';
  const cta = c.cta
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:8px 0 22px"><tr><td style="background:${BRAND.navy};border-radius:999px"><a href="${esc(c.cta.url)}" style="display:inline-block;padding:12px 26px;font:600 14px Arial,Helvetica,sans-serif;color:#ffffff;text-decoration:none;border-radius:999px">${esc(c.cta.label)}</a></td></tr></table>`
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:${BRAND.bg}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(c.preheader)}${"&#847;&zwnj;&nbsp;".repeat(90)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.bg}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${BRAND.line}">
  <tr><td style="background:${BRAND.navy};padding:22px 28px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="width:34px;height:34px;background:${BRAND.cyan};border-radius:9px;text-align:center;font:bold 19px/34px Georgia,'Times New Roman',serif;color:${BRAND.navy}">D</td>
      <td style="padding-left:12px;font:20px Georgia,'Times New Roman',serif;color:#ffffff;letter-spacing:.3px">Despina <span style="color:${BRAND.cyan}">Pharma</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="height:4px;background:${BRAND.cyan};line-height:4px;font-size:0">&nbsp;</td></tr>
  <tr><td style="padding:30px 28px 8px">
    <div style="font:600 11px/1 Arial,Helvetica,sans-serif;letter-spacing:1.6px;text-transform:uppercase;color:#0a8fa3;margin:0 0 10px">${esc(c.eyebrow)}</div>
    <h1 style="margin:0 0 18px;font:normal 26px/1.25 Georgia,'Times New Roman',serif;color:${BRAND.navy}">${esc(c.title)}</h1>
    ${c.paragraphs.map(p).join('')}
    ${quote}
    ${rows ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 18px;border-bottom:1px solid ${BRAND.line}">${rows}</table>` : ''}
    ${list}
    ${cta}
    ${(c.after ?? []).map(p).join('')}
  </td></tr>
  <tr><td style="padding:20px 28px 26px;border-top:1px solid ${BRAND.line};background:#fafbfc">
    <div style="font:15px Georgia,'Times New Roman',serif;color:${BRAND.navy}">${BRAND.name}</div>
    <div style="font:600 10px/1.8 Arial,Helvetica,sans-serif;letter-spacing:1.4px;text-transform:uppercase;color:#0a8fa3">${esc(BRAND.tagline)}</div>
    <div style="font:12px/1.6 Arial,Helvetica,sans-serif;color:${BRAND.muted};margin-top:6px">${esc(BRAND.about)}<br><a href="${esc(app)}/" style="color:${BRAND.muted}">${esc(app.replace(/^https?:\/\//, ''))}</a></div>
    <div style="font:11px/1.6 Arial,Helvetica,sans-serif;color:#98a2b3;margin-top:10px">${esc(c.reason)}</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

function text(c: Content, app: string) {
  const details = (c.details ?? []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
  return [
    c.title.toUpperCase(),
    '',
    ...c.paragraphs,
    ...(c.quote ? ['', ...String(c.quote).split('\n').map((l) => `> ${l}`)] : []),
    ...(details.length ? ['', ...details.map(([k, v]) => `${k}: ${v}`)] : []),
    ...(c.list?.length ? ['', ...c.list.map((i) => `- ${i}`)] : []),
    ...(c.cta ? ['', `${c.cta.label}: ${c.cta.url}`] : []),
    ...(c.after?.length ? ['', ...c.after] : []),
    '',
    '--',
    `${BRAND.name} – ${BRAND.tagline}`,
    app,
    c.reason,
  ].join('\n');
}

export function renderTemplate(name: TemplateName, data: Record<string, any>, appUrl: string): RenderedEmail {
  const app = (appUrl || 'http://localhost:3000').replace(/\/$/, '');
  const c = content(name, data, app);
  return { subject: String(c.subject).replace(/\s+/g, ' ').slice(0, 300), text: text(c, app), html: html(c, app) };
}

export const TEMPLATE_NAMES: TemplateName[] = [
  'owner_notice', 'customer_ack', 'lead_assigned', 'task_assigned', 'overdue_digest', 'message_to_customer', 'message_to_staff',
  'info_request', 'quote_ready', 'quote_response_staff', 'quote_response_ack', 'approval_staff', 'sample_feedback_staff',
  'sample_shipped', 'feedback_request', 'document_ready', 'approval_request', 'stage_update', 'invite', 'password_reset',
  'failure_alert', 'staff_alert', 'test',
];
