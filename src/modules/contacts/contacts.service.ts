import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConsentRecord, Contact, Inquiry } from '../../database/entities/index.js';
import { AuditService } from '../audit/audit.service.js';
import { paged } from '../../common/utils.js';
import { ContactQueryDto, CreateContactDto, UpdateContactDto } from './dto/contact.dto.js';

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(Inquiry) private readonly inquiries: Repository<Inquiry>,
    @InjectRepository(ConsentRecord) private readonly consents: Repository<ConsentRecord>,
    private readonly audit: AuditService,
  ) {}

  async list(q: ContactQueryDto) {
    const qb = this.contacts
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.company', 'company')
      .orderBy('c.createdAt', 'DESC')
      .skip((q.page - 1) * q.pageSize)
      .take(q.pageSize);
    if (q.companyId) qb.andWhere('c.companyId = :companyId', { companyId: q.companyId });
    if (q.q) qb.andWhere("(c.email ILIKE :q OR c.first_name || ' ' || coalesce(c.last_name, '') ILIKE :q)", { q: `%${q.q}%` });
    const [items, total] = await qb.getManyAndCount();
    return paged(items, total, q);
  }

  async get(id: string) {
    const contact = await this.contacts.findOne({ where: { id }, relations: { company: true } });
    if (!contact) throw new NotFoundException('Contact not found');
    const [inquiries, consents] = await Promise.all([
      this.inquiries.find({ where: { contactId: id }, order: { createdAt: 'DESC' } }),
      this.consents.find({ where: { contactId: id }, order: { createdAt: 'DESC' } }),
    ]);
    return {
      ...contact,
      inquiries: inquiries.map((i) => ({ id: i.id, referenceNo: i.referenceNo, formType: i.formType, status: i.status, createdAt: i.createdAt })),
      consents,
    };
  }

  async create(dto: CreateContactDto, actorId: string) {
    const contact = await this.contacts.save(this.contacts.create(dto));
    await this.audit.log({ actorId, action: 'contact.create', entityType: 'contact', entityId: contact.id, after: contact });
    return contact;
  }

  async update(id: string, dto: UpdateContactDto, actorId: string) {
    const before = await this.contacts.findOneBy({ id });
    if (!before) throw new NotFoundException('Contact not found');
    const after = await this.contacts.save(this.contacts.merge({ ...before }, dto));
    await this.audit.log({ actorId, action: 'contact.update', entityType: 'contact', entityId: id, before, after });
    return after;
  }
}
