import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Repository } from 'typeorm';
import { ConsentRecord, Contact } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import type { ConsentType } from '../../common/enums.js';

/**
 * Consent history (privacy / marketing / terms). Records are append-only:
 * the newest record per type is the current state.
 * Marketing opt-out is independent from transactional inquiry emails.
 */
@Injectable()
export class ConsentsService {
  constructor(
    @InjectRepository(ConsentRecord) private readonly consents: Repository<ConsentRecord>,
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    private readonly audit: AuditService,
  ) {}

  history(contactId: string) {
    return this.consents.find({ where: { contactId }, order: { createdAt: 'DESC' } });
  }

  /** Current state per consent type. */
  async current(contactId: string) {
    const rows: { consent_type: ConsentType; granted: boolean; created_at: Date }[] = await this.consents.query(
      `SELECT DISTINCT ON (consent_type) consent_type, granted, created_at
       FROM consent_records WHERE contact_id = $1 ORDER BY consent_type, created_at DESC`,
      [contactId],
    );
    return Object.fromEntries(rows.map((r) => [r.consent_type, { granted: r.granted, at: r.created_at }]));
  }

  async record(contactId: string, consentType: ConsentType, granted: boolean, ip: string | null, actorId?: string, policyVersion?: string) {
    if (!(await this.contacts.existsBy({ id: contactId }))) throw new NotFoundException('Contact not found');
    const row = await this.consents.save(
      this.consents.create({ contactId, consentType, granted, ip, policyVersion: policyVersion ?? null }),
    );
    await this.audit.log({ actorId: actorId ?? null, action: `consent.${consentType}.${granted ? 'granted' : 'withdrawn'}`, entityType: 'contact', entityId: contactId, ip });
    return row;
  }

  // ---------- signed unsubscribe links (put in marketing emails) ----------
  private sign(contactId: string) {
    const secret = process.env.APP_SECRET;
    if (!secret) throw new Error('APP_SECRET must be set');
    return createHmac('sha256', secret).update(`unsub.${contactId}`).digest('base64url');
  }

  unsubscribeLink(contactId: string) {
    // Website page that calls GET /api/public/unsubscribe and shows a friendly confirmation.
    return `${process.env.APP_URL ?? ''}/unsubscribe/?c=${contactId}&s=${this.sign(contactId)}`;
  }

  async unsubscribe(contactId: string, signature: string, ip: string | null) {
    const a = Buffer.from(this.sign(contactId));
    const b = Buffer.from(signature ?? '');
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new BadRequestException('Invalid link');
    await this.record(contactId, 'marketing', false, ip);
    return { ok: true, message: 'You will no longer receive marketing emails.' };
  }
}
