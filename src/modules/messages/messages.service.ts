import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Contact, Inquiry, Message, Project, StatusEvent, User } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { EmailService } from '../email/email.service.js';
import { isStaff, ProjectAccessService, requireStaff } from '../projects/project-access.service.js';

@Injectable()
export class MessagesService {
  constructor(
    private readonly ds: DataSource,
    private readonly access: ProjectAccessService,
    private readonly email: EmailService,
  ) {}
  async listProjectMessages(user: AuthUser, projectId: string) {
    await this.access.project(user, projectId);
    return this.ds.getRepository(Message).find({ where: { projectId }, order: { createdAt: 'ASC' } });
  }

  async postProjectMessage(user: AuthUser, projectId: string, body: string) {
    const project = await this.access.project(user, projectId);
    const repo = this.ds.getRepository(Message);
    const msg = await repo.save(repo.create({ projectId, senderId: user.id, body }));

    // Tell the other side (switchable in Settings → Emails).
    const data = { projectId, projectCode: project.code, projectName: project.name, body };
    if (isStaff(user)) {
      for (const to of await this.access.customerEmails(project.companyId)) {
        await this.email.toCustomer('reply', to, 'message_to_customer', { ...data, senderName: 'Your Despina Pharma team' }, { projectId });
      }
    } else {
      await this.email.notifyStaff('customer.message', 'message_to_staff', { ...data, senderName: user.email },
        { people: await this.access.ownerEmails(project), projectId });
    }
    return msg;
  }


  async listInquiryMessages(inquiryId: string) {
    return this.ds.getRepository(Message).find({ where: { inquiryId }, order: { createdAt: 'ASC' } });
  }

  /**
   * Staff reply to a lead, e-mailed to the contact. With askInfo the e-mail is a "more information needed"
   * request and the lead moves to "Waiting for customer".
   */
  async postInquiryMessage(user: AuthUser, inquiryId: string, body: string, askInfo = false) {
    requireStaff(user);
    const inquiry = await this.ds.getRepository(Inquiry).findOneBy({ id: inquiryId });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    const contact = await this.ds.getRepository(Contact).findOneByOrFail({ id: inquiry.contactId });
    const repo = this.ds.getRepository(Message);
    const msg = await repo.save(repo.create({ inquiryId, senderId: user.id, body }));
    const data = { inquiryId, referenceNo: inquiry.referenceNo, contactName: [contact.firstName, contact.lastName].filter(Boolean).join(' '), senderName: 'Your Despina Pharma team', body };
    if (askInfo) {
      await this.email.toCustomer('info_request', contact.email, 'info_request', data, { inquiryId });
      if (inquiry.status !== 'awaiting_customer') {
        await this.ds.getRepository(Inquiry).update(inquiryId, { status: 'awaiting_customer' });
        await this.ds.getRepository(StatusEvent).insert({ inquiryId, actorId: user.id, fromStatus: inquiry.status, toStatus: 'awaiting_customer', note: 'Asked the customer for more information' });
      }
    } else {
      await this.email.toCustomer('reply', contact.email, 'message_to_customer', data, { inquiryId });
    }
    return msg;
  }

  /**
   * Inbound email reply (called by InboundEmailController).
   * Only accepted when the sender belongs to that thread: the inquiry's own contact,
   * or a member of the project's company. Anything else is dropped.
   */
  async recordInboundReply(fromEmail: string, referenceOrCode: string, body: string) {
    const inquiry = await this.ds.getRepository(Inquiry).findOneBy({ referenceNo: referenceOrCode });
    const project = inquiry ? null : await this.ds.getRepository(Project).findOneBy({ code: referenceOrCode });
    if (!inquiry && !project) return null;
    const user = await this.ds.getRepository(User).createQueryBuilder('u').where('lower(u.email) = lower(:e)', { e: fromEmail }).getOne();
    const contact = await this.ds.getRepository(Contact).createQueryBuilder('c').where('lower(c.email) = lower(:e)', { e: fromEmail }).getOne();

    if (inquiry && contact?.id !== inquiry.contactId) return null;
    if (project) {
      const emails = await this.access.customerEmails(project.companyId);
      if (!emails.some((e) => e.toLowerCase() === fromEmail.toLowerCase())) return null;
    }
    const repo = this.ds.getRepository(Message);
    return repo.save(repo.create({
      inquiryId: inquiry?.id ?? null, projectId: project?.id ?? null, senderId: user?.id ?? null,
      senderContactId: contact?.id ?? null, body, viaEmail: true,
    }));
  }
}
