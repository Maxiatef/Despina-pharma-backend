import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { STAFF_ROLES } from '../../common/enums.js';
import type { UserRole } from '../../common/enums.js';
import { AuditService } from '../audit/audit.service.js';
import { StorageService } from '../documents/storage/storage.service.js';

/**
 * Privacy requests for one person (a contact): "send me my data" (export) and "delete my data" (erase).
 * Erasing removes the person's details everywhere but keeps the business records (leads, projects,
 * quotes, approvals) with an anonymous contact, so counts and history still add up.
 */
@Injectable()
export class PersonalDataService {
  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  private async load(id: string) {
    const [contact] = await this.ds.query(
      `SELECT c.*, co.name AS company_name, co.website AS company_website, co.country AS company_country
       FROM contacts c LEFT JOIN companies co ON co.id = c.company_id WHERE c.id = $1`, [id]);
    if (!contact) throw new NotFoundException('Contact not found');
    const users: { id: string; email: string; role: UserRole; is_active: boolean; created_at: Date; last_login_at: Date | null }[] =
      await this.ds.query(`SELECT id, email, role, is_active, created_at, last_login_at FROM users WHERE contact_id = $1`, [id]);
    const inquiries: { id: string }[] = await this.ds.query(`SELECT id FROM inquiries WHERE contact_id = $1`, [id]);
    return { contact, users, inquiryIds: inquiries.map((i) => i.id) };
  }

  /** Everything stored about this person, as one JSON document. */
  async export(id: string, actorId: string) {
    const { contact, users, inquiryIds } = await this.load(id);
    const userIds = users.map((u) => u.id);
    const [inquiries, items, messages, consents, emails, documents] = await Promise.all([
      this.ds.query(
        `SELECT id, reference_no, created_at, form_type, inquiry_type, status, message, payload, source_page
         FROM inquiries WHERE contact_id = $1 ORDER BY created_at`, [id]),
      this.ds.query(
        `SELECT ii.inquiry_id, ci.name AS product, s.title AS service, ii.quantity, ii.notes
         FROM inquiry_items ii LEFT JOIN catalog_items ci ON ci.id = ii.catalog_item_id LEFT JOIN services s ON s.id = ii.service_id
         WHERE ii.inquiry_id = ANY($1) ORDER BY ii.created_at`, [inquiryIds]),
      this.ds.query(
        `SELECT m.created_at, m.inquiry_id, m.project_id, m.body,
                CASE WHEN m.sender_contact_id = $1 OR m.sender_id = ANY($3) THEN 'you' ELSE 'Despina Pharma' END AS sender
         FROM messages m WHERE m.inquiry_id = ANY($2) OR m.sender_contact_id = $1 OR m.sender_id = ANY($3) ORDER BY m.created_at`,
        [id, inquiryIds, userIds]),
      this.ds.query(
        `SELECT consent_type, granted, policy_version, created_at FROM consent_records WHERE contact_id = $1 ORDER BY created_at`, [id]),
      this.ds.query(
        `SELECT created_at, subject, status FROM email_jobs WHERE lower(to_email) = lower($1) ORDER BY created_at`, [contact.email]),
      this.ds.query(
        `SELECT d.title, dv.original_filename, dv.size_bytes, d.created_at FROM documents d
         LEFT JOIN document_versions dv ON dv.document_id = d.id
         WHERE d.inquiry_id = ANY($1) OR dv.uploaded_by = ANY($2) ORDER BY d.created_at`, [inquiryIds, userIds]),
    ]);
    await this.audit.log({ actorId, action: 'contact.export', entityType: 'contact', entityId: id });
    return {
      exportedAt: new Date().toISOString(),
      exportedBy: 'Despina Pharma',
      person: {
        firstName: contact.first_name, lastName: contact.last_name, email: contact.email, phone: contact.phone,
        jobTitle: contact.job_title, country: contact.country, createdAt: contact.created_at,
      },
      company: contact.company_name ? { name: contact.company_name, website: contact.company_website, country: contact.company_country } : null,
      accounts: users.map((u) => ({ email: u.email, active: u.is_active, createdAt: u.created_at, lastLoginAt: u.last_login_at })),
      forms: inquiries.map((i: Record<string, any>) => ({
        reference: i.reference_no, sentAt: i.created_at, form: i.form_type, topic: i.inquiry_type, status: i.status,
        message: i.message, answers: i.payload?.fields ?? {}, page: i.source_page,
        products: items.filter((x: Record<string, any>) => x.inquiry_id === i.id).map(({ inquiry_id: _, ...x }: Record<string, any>) => x),
      })),
      messages: messages.map((m: Record<string, any>) => ({ at: m.created_at, from: m.sender, text: m.body })),
      consents: consents.map((c: Record<string, any>) => ({ type: c.consent_type, granted: c.granted, policyVersion: c.policy_version, at: c.created_at })),
      emailsSentToYou: emails.map((e: Record<string, any>) => ({ at: e.created_at, subject: e.subject, status: e.status })),
      files: documents.map((d: Record<string, any>) => ({ title: d.title, filename: d.original_filename, bytes: d.size_bytes, at: d.created_at })),
    };
  }

  /**
   * Removes the person's details. `confirm` must be the contact's e-mail address, so it cannot happen by a stray click.
   * Kept: the leads and projects themselves (without the person's text), consent dates, and staff records.
   */
  async erase(id: string, confirm: string, actorId: string) {
    const { contact, users, inquiryIds } = await this.load(id);
    if (confirm.trim().toLowerCase() !== String(contact.email).toLowerCase()) {
      throw new BadRequestException('Type the contact\'s e-mail address to confirm');
    }
    if (users.some((u) => STAFF_ROLES.includes(u.role))) {
      throw new BadRequestException('This contact belongs to a Despina staff account – remove the staff account first');
    }
    const userIds = users.map((u) => u.id);
    const tag = `erased-${id.slice(0, 8)}`;
    const erasedEmail = `${tag}@erased.invalid`;

    // Files sent with the person's website forms (files that went into a project stay with the project).
    const files: { id: string; storage_key: string }[] = await this.ds.query(
      `SELECT d.id, dv.storage_key FROM documents d LEFT JOIN document_versions dv ON dv.document_id = d.id
       WHERE d.inquiry_id = ANY($1) AND d.project_id IS NULL`, [inquiryIds]);

    await this.ds.transaction(async (m) => {
      const q = (sql: string, params: unknown[]) => m.query(sql, params);
      await q(`UPDATE contacts SET first_name = 'Erased', last_name = NULL, email = $2, phone = NULL, job_title = NULL, country = NULL,
                 email_status = NULL, email_status_at = NULL, email_status_detail = NULL WHERE id = $1`, [id, erasedEmail]);
      await q(`UPDATE inquiries SET message = NULL, payload = '{}'::jsonb, ip = NULL, user_agent = NULL WHERE id = ANY($1)`, [inquiryIds]);
      await q(`UPDATE inquiry_items SET notes = NULL WHERE inquiry_id = ANY($1)`, [inquiryIds]);
      await q(`UPDATE messages SET body = '[removed on request]' WHERE (inquiry_id = ANY($1) AND project_id IS NULL) OR sender_contact_id = $2`, [inquiryIds, id]);
      await q(`UPDATE consent_records SET ip = NULL WHERE contact_id = $1`, [id]);
      const jobs: { id: string }[] = await q(
        `SELECT id FROM email_jobs WHERE inquiry_id = ANY($1) OR lower(to_email) = lower($2)`, [inquiryIds, contact.email]);
      const jobIds = jobs.map((j) => j.id);
      await q(`UPDATE email_jobs SET body_text = NULL, body_html = NULL, subject = '(removed on request)' WHERE id = ANY($1)`, [jobIds]);
      await q(`UPDATE email_jobs SET to_email = $2 WHERE id = ANY($1) AND lower(to_email) = lower($3)`, [jobIds, erasedEmail, contact.email]);
      await q(`UPDATE email_events SET raw = '{}'::jsonb WHERE email_job_id = ANY($1)`, [jobIds]);
      if (files.length) await q(`DELETE FROM documents WHERE id = ANY($1)`, [[...new Set(files.map((f) => f.id))]]);
      // Customer login: closed and anonymised (approvals they gave stay, signed by the anonymous account).
      for (const u of userIds) {
        await q(`UPDATE users SET email = $2, password_hash = NULL, mfa_secret = NULL, mfa_enabled = false, is_active = false WHERE id = $1`,
          [u, `${tag}-${u.slice(0, 4)}@erased.invalid`]);
        await q(`DELETE FROM sessions WHERE user_id = $1`, [u]);
        await q(`DELETE FROM company_memberships WHERE user_id = $1`, [u]);
      }
      // The activity log copied their details into before/after snapshots; keep the entries, drop the copies.
      await q(
        `UPDATE audit_events SET before = NULL, after = NULL, details = NULL, summary = NULL, entity_label = NULL, ip = NULL, user_agent = NULL
         WHERE (entity_type = 'contact' AND entity_id = $1) OR inquiry_id = ANY($2) OR (entity_type = 'inquiry' AND entity_id = ANY($2))
            OR (entity_type = 'user' AND entity_id = ANY($3)) OR actor_id = ANY($3)`, [id, inquiryIds, userIds]);
      await q(`UPDATE audit_events SET actor_email = NULL WHERE actor_id = ANY($1)`, [userIds]);
      for (const inquiryId of inquiryIds) {
        await q(`INSERT INTO status_events (inquiry_id, actor_id, note) VALUES ($1, $2, 'Personal data removed on request')`, [inquiryId, actorId]);
      }
    });
    for (const f of files) if (f.storage_key) await this.storage.remove(f.storage_key);
    await this.audit.log({
      actorId, action: 'contact.erase', entityType: 'contact', entityId: id,
      after: { forms: inquiryIds.length, accounts: userIds.length, filesDeleted: files.length },
    });
    return { ok: true, forms: inquiryIds.length, accounts: userIds.length, filesDeleted: files.length };
  }
}
