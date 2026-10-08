/**
 * Every API route that changes something → how it appears in the audit log.
 * AuditInterceptor writes one row per successful request using this table; a route that changes data but is
 * missing here is still logged (generic "<method> <path>"), so nothing goes unrecorded.
 *
 *  action  stable name (filterable)          entity  record type          table  table to snapshot before/after
 *  id      where the record id is: a route param name, 'result' (created record), 'body.<field>', or 'self' (the actor)
 *  say     the sentence after the actor's name; {label} = name/reference of the record, {b.x} = request body field,
 *          {r.x} = response field, {user:x} = e-mail of the user whose id is in body/param x
 */
export interface AuditRoute {
  action: string;
  entity: string;
  table?: string;
  id?: string;
  say: string;
}

/** Routes that are never logged: sign-in / sign-out (by request), upload steps (logged once at "complete"), machine calls. */
export const AUDIT_SKIP = new Set([
  'POST /auth/login', 'POST /auth/logout', 'DELETE /auth/sessions/:id', 'POST /auth/sessions/revoke-all',
  'POST /uploads/initiate', 'PUT /uploads/:id/content',
  'POST /webhooks/email-events', 'POST /webhooks/email-inbound',
]);

export const AUDIT_ROUTES: Record<string, AuditRoute> = {
  // ---------- website forms (visitors, no account) ----------
  'POST /inquiries': { action: 'inquiry.submit', entity: 'inquiry', table: 'inquiries', id: 'result', say: 'sent the {b.formType} form from the website ({label})' },
  'POST /project-briefs': { action: 'inquiry.submit', entity: 'inquiry', table: 'inquiries', id: 'result', say: 'sent a product brief from the website ({label})' },
  'POST /sample-requests': { action: 'inquiry.submit', entity: 'inquiry', table: 'inquiries', id: 'result', say: 'sent a sample request from the website ({label})' },
  'POST /uploads/complete': { action: 'document.upload', entity: 'document', table: 'documents', id: 'body.documentId', say: 'uploaded the file "{label}"' },

  // ---------- account ----------
  'POST /auth/accept-invite': { action: 'auth.accept_invite', entity: 'user', say: 'accepted the invitation and set a password' },
  'POST /auth/password/forgot': { action: 'auth.password_forgot', entity: 'user', say: 'asked for a password reset link for {b.email}' },
  'POST /auth/password/reset': { action: 'auth.password_reset', entity: 'user', say: 'reset the password with an e-mailed link' },
  'POST /auth/password/change': { action: 'auth.password_change', entity: 'user', id: 'self', say: 'changed their password' },
  'POST /auth/mfa/setup': { action: 'auth.mfa_setup', entity: 'user', id: 'self', say: 'started setting up two-factor sign-in' },
  'POST /auth/mfa/enable': { action: 'auth.mfa_enable', entity: 'user', table: 'users', id: 'self', say: 'turned on two-factor sign-in' },
  'POST /auth/mfa/disable': { action: 'auth.mfa_disable', entity: 'user', table: 'users', id: 'self', say: 'turned off two-factor sign-in' },
  'PATCH /portal/me': { action: 'profile.update', entity: 'user', table: 'users', id: 'self', say: 'updated their profile' },

  // ---------- users (admin) ----------
  'POST /users/invite': { action: 'user.invite', entity: 'user', table: 'users', id: 'result', say: 'invited {b.email} as {b.role}' },
  'POST /users/:id/resend-invite': { action: 'user.invite_resend', entity: 'user', table: 'users', id: 'id', say: 'sent a new invitation to {label}' },
  'PATCH /users/:id': { action: 'user.update', entity: 'user', table: 'users', id: 'id', say: 'updated the user {label}' },
  'POST /users/:id/reset-mfa': { action: 'user.mfa_reset', entity: 'user', table: 'users', id: 'id', say: 'reset two-factor sign-in of {label}' },

  // ---------- companies & contacts ----------
  'POST /companies': { action: 'company.create', entity: 'company', table: 'companies', id: 'result', say: 'created the company {label}' },
  'PATCH /companies/:id': { action: 'company.update', entity: 'company', table: 'companies', id: 'id', say: 'updated the company {label}' },
  'DELETE /companies/:id': { action: 'company.delete', entity: 'company', table: 'companies', id: 'id', say: 'deleted the company {label}' },
  'POST /companies/:id/members': { action: 'company.member_add', entity: 'company', table: 'companies', id: 'id', say: 'gave {user:userId} access to {label}' },
  'DELETE /companies/:id/members/:userId': { action: 'company.member_remove', entity: 'company', table: 'companies', id: 'id', say: 'removed {user:userId} from {label}' },
  'POST /contacts': { action: 'contact.create', entity: 'contact', table: 'contacts', id: 'result', say: 'created the contact {label}' },
  'PATCH /contacts/:id': { action: 'contact.update', entity: 'contact', table: 'contacts', id: 'id', say: 'updated the contact {label}' },
  'POST /contacts/:contactId/consents': { action: 'contact.consent', entity: 'contact', table: 'contacts', id: 'contactId', say: 'recorded {b.consentType} consent = {b.granted} for {label}' },

  // ---------- leads ----------
  'PATCH /inquiries/:id/status': { action: 'inquiry.status', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'changed the status of {label} to {b.status}' },
  'POST /inquiries/:id/notes': { action: 'inquiry.note', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'added an internal note to {label}: "{b.note}"' },
  'POST /inquiries/:id/assign': { action: 'inquiry.assign', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'assigned {label} (and its unassigned tasks) to {user:userId}' },
  'DELETE /inquiries/:id/assign': { action: 'inquiry.unassign', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'unassigned {label}' },
  'POST /inquiries/:id/messages': { action: 'inquiry.message', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'replied to the customer on {label}' },
  'POST /inquiries/:id/convert': { action: 'inquiry.convert', entity: 'inquiry', table: 'inquiries', id: 'id', say: 'converted {label} into project {r.code}' },

  // ---------- tasks ----------
  'POST /tasks': { action: 'task.create', entity: 'task', table: 'tasks', id: 'result', say: 'created the task "{label}"' },
  'PATCH /tasks/:id': { action: 'task.update', entity: 'task', table: 'tasks', id: 'id', say: 'updated the task "{label}"' },
  'POST /tasks/:id/assign': { action: 'task.assign', entity: 'task', table: 'tasks', id: 'id', say: 'assigned the task "{label}" to {user:userId}' },
  'POST /tasks/:id/complete': { action: 'task.complete', entity: 'task', table: 'tasks', id: 'id', say: 'completed the task "{label}"' },
  'POST /tasks/:id/reopen': { action: 'task.reopen', entity: 'task', table: 'tasks', id: 'id', say: 'reopened the task "{label}"' },
  'DELETE /tasks/:id': { action: 'task.delete', entity: 'task', table: 'tasks', id: 'id', say: 'deleted the task "{label}"' },
  'POST /tasks/send-overdue-digest': { action: 'task.send_reminders', entity: 'task', say: 'sent the overdue-task reminders now' },

  // ---------- projects ----------
  'POST /projects': { action: 'project.create', entity: 'project', table: 'projects', id: 'result', say: 'created the project {label}' },
  'PATCH /projects/:id': { action: 'project.update', entity: 'project', table: 'projects', id: 'id', say: 'updated the project {label}' },
  'POST /projects/:id/stages/:stageId/complete': { action: 'stage.complete', entity: 'project_stage', table: 'project_stages', id: 'stageId', say: 'completed the stage "{label}"' },
  'POST /projects/:id/products': { action: 'product.add', entity: 'project_product', table: 'project_products', id: 'result', say: 'added the product "{label}" to the project' },
  'PATCH /project-products/:id': { action: 'product.update', entity: 'project_product', table: 'project_products', id: 'id', say: 'updated the product "{label}"' },
  'DELETE /project-products/:id': { action: 'product.remove', entity: 'project_product', table: 'project_products', id: 'id', say: 'removed the product "{label}" from the project' },
  'POST /project-products/:id/stages': { action: 'product.stages', entity: 'project_product', table: 'project_products', id: 'id', say: 'set the stages of the product "{label}"' },
  'POST /projects/:id/messages': { action: 'project.message', entity: 'message', table: 'messages', id: 'result', say: 'sent a message on the project' },
  'POST /projects/:id/approvals': { action: 'approval.create', entity: 'approval', table: 'approvals', id: 'result', say: 'approved {b.targetType} ("{b.confirmationText}")' },

  // ---------- briefs & samples ----------
  'POST /project-products/:id/briefs': { action: 'brief.create', entity: 'brief', table: 'briefs', id: 'result', say: 'created the brief "{label}"' },
  'POST /briefs/:id/versions': { action: 'brief.version', entity: 'brief', table: 'briefs', id: 'id', say: 'saved a new version of the brief "{label}"' },
  'POST /project-products/:id/samples': { action: 'sample.create', entity: 'sample', table: 'samples', id: 'result', say: 'created the sample "{label}"' },
  'PATCH /samples/:id': { action: 'sample.update', entity: 'sample', table: 'samples', id: 'id', say: 'updated the sample "{label}"' },
  'POST /samples/:id/revisions': { action: 'sample.revision', entity: 'sample', table: 'samples', id: 'id', say: 'added a revision to the sample "{label}"' },
  'PATCH /sample-revisions/:id': { action: 'sample.revision_update', entity: 'sample_revision', table: 'sample_revisions', id: 'id', say: 'updated sample revision {label}' },
  'POST /sample-revisions/:id/feedback': { action: 'sample.feedback', entity: 'sample_revision', table: 'sample_revisions', id: 'id', say: 'gave feedback ({b.rating}/5) on sample revision {label}' },

  // ---------- quotes ----------
  'POST /projects/:id/quotes': { action: 'quote.create', entity: 'quote', table: 'quotes', id: 'result', say: 'created the quote {label}' },
  'POST /quotes/:id/versions': { action: 'quote.revise', entity: 'quote', table: 'quotes', id: 'id', say: 'made a new version of the quote {label}' },
  'POST /quotes/:id/send': { action: 'quote.send', entity: 'quote', table: 'quotes', id: 'id', say: 'sent the quote {label} to the customer' },
  'PATCH /quotes/:id': { action: 'quote.status', entity: 'quote', table: 'quotes', id: 'id', say: 'marked the quote {label} as {b.status}' },
  'POST /quotes/:id/respond': { action: 'quote.respond', entity: 'quote', table: 'quotes', id: 'id', say: 'answered the quote {label}: {b.decision}' },

  // ---------- documents ----------
  'PATCH /documents/:id': { action: 'document.update', entity: 'document', table: 'documents', id: 'id', say: 'updated the document "{label}"' },
  'POST /document-versions/:id/scan': { action: 'document.scan', entity: 'document_version', table: 'document_versions', id: 'id', say: 'marked the file "{label}" as {b.scanStatus}' },
  'POST /document-versions/:id/download-link': { action: 'document.download', entity: 'document_version', table: 'document_versions', id: 'id', say: 'downloaded the file "{label}"' },

  // ---------- catalog & website content ----------
  'POST /admin/catalog/categories': { action: 'catalog_category.create', entity: 'catalog_category', table: 'catalog_categories', id: 'result', say: 'created the catalog category {label}' },
  'PATCH /admin/catalog/categories/:id': { action: 'catalog_category.update', entity: 'catalog_category', table: 'catalog_categories', id: 'id', say: 'updated the catalog category {label}' },
  'POST /admin/catalog/sources': { action: 'catalog_source.create', entity: 'catalog_source', table: 'catalog_sources', id: 'result', say: 'created the catalog source {label}' },
  'PATCH /admin/catalog/sources/:id': { action: 'catalog_source.update', entity: 'catalog_source', table: 'catalog_sources', id: 'id', say: 'updated the catalog source {label}' },
  'POST /admin/catalog/items': { action: 'catalog_item.create', entity: 'catalog_item', table: 'catalog_items', id: 'result', say: 'created the catalog item {label}' },
  'PATCH /admin/catalog/items/:id': { action: 'catalog_item.update', entity: 'catalog_item', table: 'catalog_items', id: 'id', say: 'updated the catalog item {label}' },
  'POST /admin/services': { action: 'service.create', entity: 'service', table: 'services', id: 'result', say: 'created the service {label}' },
  'PATCH /admin/services/:id': { action: 'service.update', entity: 'service', table: 'services', id: 'id', say: 'updated the service {label}' },
  'POST /admin/faqs': { action: 'faq.create', entity: 'faq', table: 'faqs', id: 'result', say: 'created the FAQ "{label}"' },
  'PATCH /admin/faqs/:id': { action: 'faq.update', entity: 'faq', table: 'faqs', id: 'id', say: 'updated the FAQ "{label}"' },
  'DELETE /admin/faqs/:id': { action: 'faq.delete', entity: 'faq', table: 'faqs', id: 'id', say: 'deleted the FAQ "{label}"' },
  'POST /admin/redirects': { action: 'redirect.create', entity: 'redirect', table: 'redirects', id: 'result', say: 'created the redirect {label}' },
  'PATCH /admin/redirects/:id': { action: 'redirect.update', entity: 'redirect', table: 'redirects', id: 'id', say: 'updated the redirect {label}' },
  'DELETE /admin/redirects/:id': { action: 'redirect.delete', entity: 'redirect', table: 'redirects', id: 'id', say: 'deleted the redirect {label}' },
  'POST /stage-templates': { action: 'stage_template.create', entity: 'stage_template', table: 'stage_templates', id: 'result', say: 'created the stage template {label}' },
  'PATCH /stage-templates/:id': { action: 'stage_template.update', entity: 'stage_template', table: 'stage_templates', id: 'id', say: 'updated the stage template {label}' },

  // ---------- e-mail ----------
  'POST /email-jobs/:id/retry': { action: 'email.retry', entity: 'email_job', table: 'email_jobs', id: 'id', say: 'retried the e-mail "{label}"' },
};

/** Record types for the audit filter (entity_type values). */
export const AUDIT_ENTITY_TYPES = [...new Set(Object.values(AUDIT_ROUTES).map((r) => r.entity))].sort();
