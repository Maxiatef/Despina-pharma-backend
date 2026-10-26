import { BadRequestException, ForbiddenException, Injectable, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { extname } from 'node:path';
import { DataSource, In } from 'typeorm';
import { Approval, Document, DocumentVersion, Project, StatusEvent, User } from '../../database/entities/index.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import type { DocumentVisibility } from '../../common/enums.js';
import { sha256 } from '../../common/utils.js';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../email/email.service.js';
import { isStaff, ProjectAccessService } from '../projects/project-access.service.js';
import { StorageService } from './storage/storage.service.js';
import { ScanService } from './storage/scan.service.js';
import { signUploadToken, verifyUploadToken } from './upload-token.js';

/** Allowed types (brief: PDF/JPG/PNG/DOCX/XLSX), checked by extension, declared type AND file signature. */
const ALLOWED: Record<string, { mimes: string[]; magic: (b: Buffer) => boolean }> = {
  '.pdf': { mimes: ['application/pdf'], magic: (b) => b.subarray(0, 5).toString() === '%PDF-' },
  '.png': { mimes: ['image/png'], magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mimes: ['image/jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mimes: ['image/jpeg'], magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.docx': {
    mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && b.includes('word/'),
  },
  '.xlsx': {
    mimes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && b.includes('xl/'),
  },
};

const maxBytes = () => Number(process.env.UPLOAD_MAX_MB ?? 10) * 1024 * 1024;
export const maxFiles = () => Number(process.env.UPLOAD_MAX_FILES ?? 5);

function allowedExtensions() {
  const configured = (process.env.UPLOAD_ALLOWED_EXTENSIONS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return configured.length ? configured.filter((e) => ALLOWED[e]) : Object.keys(ALLOWED);
}

export interface InitiateInput {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  title?: string;
  projectId?: string;
  documentId?: string; // upload a new version of an existing document
  visibility?: DocumentVisibility;
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly ds: DataSource,
    private readonly storage: StorageService,
    private readonly scanner: ScanService,
    private readonly access: ProjectAccessService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
  ) {}

  /** Customers of the project get "new document available" when a customer-visible file version is ready. */
  private async notifyDocumentReady(documentId: string, versionId: string) {
    const doc = await this.ds.getRepository(Document).findOneBy({ id: documentId });
    if (!doc?.projectId || doc.visibility !== 'customer') return;
    const version = await this.ds.getRepository(DocumentVersion).findOneBy({ id: versionId });
    const project = await this.ds.getRepository(Project).findOneBy({ id: doc.projectId });
    if (!version || version.scanStatus !== 'clean' || !project) return;
    for (const to of await this.access.customerEmails(project.companyId)) {
      await this.email.toCustomer('document_ready', to, 'document_ready', {
        projectId: project.id, projectName: project.name, title: doc.title, versionNo: version.versionNo, filename: version.originalFilename,
      }, { projectId: project.id });
    }
  }

  /** Staff ask the customer to review and approve the latest version of a document. */
  async requestApproval(user: AuthUser, documentId: string, note?: string) {
    const doc = await this.ds.getRepository(Document).findOneBy({ id: documentId });
    if (!doc?.projectId) throw new NotFoundException('Document not found');
    if (doc.visibility !== 'customer') throw new BadRequestException('Make the document visible to the customer first');
    const version = await this.ds.getRepository(DocumentVersion).findOne({ where: { documentId }, order: { versionNo: 'DESC' } });
    if (!version || version.scanStatus !== 'clean') throw new BadRequestException('The latest version must be released (clean) first');
    const uploader = version.uploadedBy ? await this.ds.getRepository(User).findOneBy({ id: version.uploadedBy }) : null;
    if (!uploader || uploader.role === 'customer') throw new BadRequestException('The customer uploaded this file – only team files can be approved');
    const project = await this.ds.getRepository(Project).findOneByOrFail({ id: doc.projectId });
    const to = await this.access.customerEmails(project.companyId);
    if (!to.length) throw new BadRequestException('Nobody from this company has a workspace account yet – invite the customer first');
    const jobs = [];
    for (const address of to) {
      jobs.push(await this.email.toCustomer('approval_request', address, 'approval_request', {
        projectId: project.id, projectName: project.name, title: doc.title, versionNo: version.versionNo, note: note?.trim() || null,
      }, { projectId: project.id }));
    }
    if (jobs.every((j) => j === null)) throw new BadRequestException('"Approval requested" e-mails are switched off in Settings → Emails');
    await this.ds.getRepository(DocumentVersion).update(version.id, { approvalRequestedAt: new Date() });
    await this.ds.getRepository(StatusEvent).insert({ projectId: project.id, actorId: user.id, note: `Approval requested for "${doc.title}" v${version.versionNo}` });
    return { sentTo: to, versionNo: version.versionNo };
  }

  private validateMeta(filename: string, mimeType: string, size: number) {
    const ext = extname(filename).toLowerCase();
    const rule = ALLOWED[ext];
    if (!rule || !allowedExtensions().includes(ext)) throw new BadRequestException(`File type not allowed. Allowed: ${allowedExtensions().join(', ')}`);
    if (!rule.mimes.includes(mimeType)) throw new BadRequestException('File type does not match its extension');
    if (size <= 0 || size > maxBytes()) throw new PayloadTooLargeException(`Files must be at most ${process.env.UPLOAD_MAX_MB ?? 10} MB`);
    return { ext, rule };
  }

  /** Step 1: register the upload and get a one-document token. Works for anonymous visitors (inquiry attachments). */
  async initiate(input: InitiateInput, user: AuthUser | undefined) {
    this.validateMeta(input.filename, input.mimeType, input.sizeBytes);
    const docs = this.ds.getRepository(Document);

    let document: Document;
    if (input.documentId) {
      if (!user) throw new ForbiddenException('Login required to add a version');
      const existing = await docs.findOneBy({ id: input.documentId });
      if (!existing) throw new NotFoundException('Document not found');
      await this.assertDocumentAccess(user, existing);
      document = existing;
    } else {
      if (input.projectId && !user) throw new ForbiddenException('Login required for project uploads');
      const project = input.projectId ? await this.access.project(user!, input.projectId) : null;
      document = await docs.save(
        docs.create({
          title: (input.title ?? input.filename).slice(0, 300),
          projectId: project?.id ?? null,
          companyId: project?.companyId ?? null,
          uploadedBy: user?.id ?? null,
          // Customer uploads into a project are visible to that customer; staff choose.
          visibility: user && isStaff(user) ? (input.visibility ?? 'internal') : 'customer',
        }),
      );
    }

    return {
      documentId: document.id,
      uploadToken: signUploadToken(document.id),
      uploadUrl: `/api/uploads/${document.id}/content`,
      method: 'PUT',
      headers: { 'Content-Type': input.mimeType, 'X-Upload-Token': '<uploadToken>', 'X-Filename': encodeURIComponent(input.filename) },
      maxBytes: maxBytes(),
    };
  }

  /** Step 2: send the bytes. Validates the real file signature and size, hashes it and stores it privately. */
  async putContent(documentId: string, token: string, filename: string, mimeType: string, body: Buffer, user: AuthUser | undefined) {
    if (!token || !verifyUploadToken(documentId, token)) throw new ForbiddenException('Invalid upload token');
    if (!Buffer.isBuffer(body) || body.length === 0) throw new BadRequestException('Empty file');
    const { ext, rule } = this.validateMeta(filename, mimeType, body.length);
    if (!rule.magic(body)) throw new BadRequestException('File content does not match its type');

    const doc = await this.ds.getRepository(Document).findOneBy({ id: documentId });
    if (!doc) throw new NotFoundException('Document not found');
    const versions = this.ds.getRepository(DocumentVersion);
    const last = await versions.findOne({ where: { documentId }, order: { versionNo: 'DESC' } });
    // Anonymous visitors may upload once per document (no silent replacement of attached files).
    if (last && !user) throw new ForbiddenException('This upload is already complete');
    if (last && user) await this.assertDocumentAccess(user, doc);

    const storageKey = `${new Date().toISOString().slice(0, 7)}/${randomUUID()}${ext}`;
    await this.storage.put(storageKey, body);
    const scanStatus = await this.scanner.scan(body);

    const version = await versions.save(
      versions.create({
        documentId,
        versionNo: (last?.versionNo ?? 0) + 1,
        storageKey,
        originalFilename: filename.slice(0, 300),
        mimeType,
        sizeBytes: String(body.length),
        sha256: sha256(body),
        scanStatus,
        uploadedBy: user?.id ?? null,
      }),
    );
    // Staff upload that is already clean (automatic scanning) → tell the customer now; manual mode tells them on release.
    if (user && isStaff(user) && scanStatus === 'clean') await this.notifyDocumentReady(documentId, version.id);
    return { documentId, versionId: version.id, versionNo: version.versionNo, sha256: version.sha256, scanStatus };
  }

  /** Step 3: confirm. Returns the stored version so the form can attach { documentId, token } to the inquiry. */
  async complete(documentId: string, token: string) {
    if (!verifyUploadToken(documentId, token)) throw new ForbiddenException('Invalid upload token');
    const version = await this.ds.getRepository(DocumentVersion).findOne({ where: { documentId }, order: { versionNo: 'DESC' } });
    if (!version) throw new BadRequestException('No file was uploaded yet');
    return { documentId, versionId: version.id, originalFilename: version.originalFilename, sizeBytes: version.sizeBytes, scanStatus: version.scanStatus };
  }

  // ---------- documents ----------
  private async assertDocumentAccess(user: AuthUser, doc: Document) {
    if (isStaff(user)) return;
    if (!doc.projectId || doc.visibility !== 'customer') throw new NotFoundException('Document not found');
    await this.access.project(user, doc.projectId);
  }

  async listForProject(user: AuthUser, projectId: string) {
    await this.access.project(user, projectId);
    const where = isStaff(user) ? { projectId } : { projectId, visibility: 'customer' as const };
    const docs = await this.ds.getRepository(Document).find({ where, order: { createdAt: 'DESC' } });
    return this.withLatestVersion(docs);
  }

  async listForInquiry(inquiryId: string) {
    const docs = await this.ds.getRepository(Document).find({ where: { inquiryId }, order: { createdAt: 'DESC' } });
    return this.withLatestVersion(docs);
  }

  private async withLatestVersion(docs: Document[]) {
    if (!docs.length) return [];
    const rows: DocumentVersion[] = await this.ds
      .getRepository(DocumentVersion)
      .createQueryBuilder('v')
      .distinctOn(['v.documentId'])
      .where('v.documentId IN (:...ids)', { ids: docs.map((d) => d.id) })
      .orderBy('v.documentId')
      .addOrderBy('v.versionNo', 'DESC')
      .getMany();
    // Customers can only approve files the team uploaded, so the list says who uploaded each version.
    const uploaderIds = [...new Set(rows.map((r) => r.uploadedBy).filter((x): x is string => !!x))];
    const uploaders = uploaderIds.length ? await this.ds.getRepository(User).findBy({ id: In(uploaderIds) }) : [];
    const staffIds = new Set(uploaders.filter((u) => u.role !== 'customer').map((u) => u.id));
    // When the latest version was approved, so the list shows "Approved" instead of the buttons.
    const approvals: Approval[] = rows.length ? await this.ds.getRepository(Approval).findBy({ documentVersionId: In(rows.map((r) => r.id)) }) : [];
    return docs.map((d) => {
      const v = rows.find((r) => r.documentId === d.id);
      const approvedAt = v && approvals.filter((a) => a.documentVersionId === v.id).map((a) => a.approvedAt).sort().pop();
      // storageKey is the file's place on the server – never sent to the browser (same as get()).
      return { ...d, latestVersion: v ? { ...v, storageKey: undefined, uploadedByStaff: !!v.uploadedBy && staffIds.has(v.uploadedBy), approvedAt: approvedAt ?? null } : null };
    });
  }

  async get(user: AuthUser, id: string) {
    const doc = await this.ds.getRepository(Document).findOneBy({ id });
    if (!doc) throw new NotFoundException('Document not found');
    await this.assertDocumentAccess(user, doc);
    const versions = await this.ds.getRepository(DocumentVersion).find({ where: { documentId: id }, order: { versionNo: 'DESC' } });
    return { ...doc, versions: versions.map((v) => ({ ...v, storageKey: undefined })) };
  }

  async update(user: AuthUser, id: string, patch: { title?: string; visibility?: DocumentVisibility }) {
    const doc = await this.ds.getRepository(Document).findOneBy({ id });
    if (!doc) throw new NotFoundException('Document not found');
    await this.ds.getRepository(Document).update(id, patch);
    await this.audit.log({ actorId: user.id, action: 'document.update', entityType: 'document', entityId: id, before: doc, after: patch });
    return this.get(user, id);
  }

  /** Staff release/quarantine a file (manual scan mode). */
  async setScanStatus(user: AuthUser, versionId: string, scanStatus: 'clean' | 'infected') {
    const v = await this.ds.getRepository(DocumentVersion).findOneBy({ id: versionId });
    if (!v) throw new NotFoundException('Version not found');
    await this.ds.getRepository(DocumentVersion).update(versionId, { scanStatus });
    if (scanStatus === 'infected') await this.storage.remove(v.storageKey);
    if (scanStatus === 'clean' && v.scanStatus !== 'clean') await this.notifyDocumentReady(v.documentId, versionId);
    await this.audit.log({ actorId: user.id, action: `document.scan_${scanStatus}`, entityType: 'document', entityId: v.documentId, after: { versionId } });
    return { versionId, scanStatus };
  }

  // ---------- signed, expiring download links ----------
  private sign(versionId: string, exp: number) {
    return createHmac('sha256', process.env.APP_SECRET ?? '').update(`dl.${versionId}.${exp}`).digest('base64url');
  }

  async downloadLink(user: AuthUser, versionId: string) {
    const v = await this.ds.getRepository(DocumentVersion).findOneBy({ id: versionId });
    if (!v) throw new NotFoundException('Version not found');
    const doc = await this.ds.getRepository(Document).findOneByOrFail({ id: v.documentId });
    await this.assertDocumentAccess(user, doc);
    if (v.scanStatus !== 'clean') throw new ForbiddenException(`File not available (scan status: ${v.scanStatus})`);
    const ttl = Number(process.env.DOWNLOAD_LINK_TTL_SECONDS ?? 300);
    const exp = Math.floor(Date.now() / 1000) + ttl;
    await this.audit.log({ actorId: user.id, action: 'document.download_link', entityType: 'document', entityId: doc.id, after: { versionId } });
    return { url: `/api/files/${versionId}?exp=${exp}&sig=${this.sign(versionId, exp)}`, expiresAt: new Date(exp * 1000) };
  }

  async openSigned(versionId: string, exp: string, sig: string) {
    const expNum = Number(exp);
    if (!expNum || expNum < Date.now() / 1000) throw new ForbiddenException('Link expired');
    const expected = Buffer.from(this.sign(versionId, expNum));
    const given = Buffer.from(sig ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new ForbiddenException('Invalid link');
    const v = await this.ds.getRepository(DocumentVersion).findOneBy({ id: versionId, scanStatus: 'clean' });
    if (!v || !(await this.storage.exists(v.storageKey))) throw new NotFoundException('File not found');
    return { version: v, stream: this.storage.read(v.storageKey) };
  }
}
