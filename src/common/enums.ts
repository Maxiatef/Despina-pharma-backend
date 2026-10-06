// Mirrors the PostgreSQL ENUM types created in the initial migration.
export const USER_ROLES = ['admin', 'sales', 'rnd', 'packaging', 'quality', 'production', 'customer'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const STAFF_ROLES: UserRole[] = ['admin', 'sales', 'rnd', 'packaging', 'quality', 'production'];

export const MEMBER_ROLES = ['owner', 'member', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const CATALOG_ITEM_KINDS = ['stock-reference', 'concept', 'base', 'development-program', 'despina-formula',
  'assortment', 'product-type', 'format-option', 'program-service'] as const;
export type CatalogItemKind = (typeof CATALOG_ITEM_KINDS)[number];

export const FORM_TYPES = ['contact', 'new_customer', 'new_product', 'sample_request', 'sample_feedback', 'service'] as const;
export type FormType = (typeof FORM_TYPES)[number];

export const INQUIRY_STATUSES = ['new', 'assigned', 'awaiting_customer', 'qualified', 'quoted', 'won', 'lost', 'closed', 'not_a_fit'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const DOCUMENT_VISIBILITIES = ['internal', 'customer'] as const;
export type DocumentVisibility = (typeof DOCUMENT_VISIBILITIES)[number];

export const SCAN_STATUSES = ['pending', 'clean', 'infected', 'failed'] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const EMAIL_KINDS = ['owner_notice', 'customer_ack', 'staff_alert', 'message_notice', 'quote_notice', 'invite', 'password_reset'] as const;
export type EmailKind = (typeof EMAIL_KINDS)[number];

export const EMAIL_JOB_STATUSES = ['queued', 'sending', 'sent', 'failed'] as const;
export type EmailJobStatus = (typeof EMAIL_JOB_STATUSES)[number];

export const EMAIL_EVENT_TYPES = ['delivered', 'bounced', 'complaint', 'failed', 'opened', 'unsubscribed'] as const;
export type EmailEventType = (typeof EMAIL_EVENT_TYPES)[number];

export const CONSENT_TYPES = ['privacy', 'marketing', 'terms'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const PROJECT_STATUSES = ['active', 'on_hold', 'completed', 'cancelled'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const SAMPLE_STATUSES = ['requested', 'in_development', 'shipped', 'feedback_received', 'approved', 'rejected'] as const;
export type SampleStatus = (typeof SAMPLE_STATUSES)[number];

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const APPROVAL_TARGETS = ['document_version', 'sample_revision', 'quote_version', 'brief_version'] as const;
export type ApprovalTarget = (typeof APPROVAL_TARGETS)[number];

export const AUDIT_ENTITIES = ['company', 'contact', 'user', 'inquiry', 'project', 'document', 'sample', 'quote', 'approval', 'catalog_item', 'service', 'faq', 'settings'] as const;
export type AuditEntity = (typeof AUDIT_ENTITIES)[number];
