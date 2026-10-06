import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Contact, Inquiry, Message, Project, User } from '../../database/entities/index.js';
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

    // Notify the other side.
    const recipients = isStaff(user)
      ? await this.access.customerEmails(project.companyId)
      : await this.access.staffEmails(project);
    for (const to of recipients) {
      await this.email.queue({
        kind: 'message_notice', to, template: 'message_notice', projectId,
        data: { projectCode: project.code, senderName: user.email, body },
      });
    }
    return msg;
  }


  async listInquiryMessages(inquiryId: string) {
    return this.ds.getRepository(Message).find({ where: { inquiryId }, order: { createdAt: 'ASC' } });
  }

  /** Staff reply to a lead (emailed to the contact). */
  async postInquiryMessage(user: AuthUser, inquiryId: string, body: string) {
    requireStaff(user);
    const inquiry = await this.ds.getRepository(Inquiry).findOneBy({ id: inquiryId });
    if (!inquiry) throw new NotFoundException('Inquiry not found');
    const contact = await this.ds.getRepository(Contact).findOneByOrFail({ id: inquiry.contactId });
    const repo = this.ds.getRepository(Message);
    const msg = await repo.save(repo.create({ inquiryId, senderId: user.id, body }));
    await this.email.queue({
      kind: 'message_notice', to: contact.email, template: 'message_notice', inquiryId,
      data: { referenceNo: inquiry.referenceNo, senderName: 'Despina Pharma', body },
    });
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
