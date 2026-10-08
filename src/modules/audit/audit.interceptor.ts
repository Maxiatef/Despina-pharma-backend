import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { Request, Response } from 'express';
import { Observable, mergeMap } from 'rxjs';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { clientIp } from '../../common/utils.js';
import { auditContext } from './audit-context.js';
import type { AuditRequestContext } from './audit-context.js';
import { AUDIT_ROUTES, AUDIT_SKIP } from './audit-routes.js';
import type { AuditRoute } from './audit-routes.js';
import { AuditService } from './audit.service.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Never stored: secrets in request bodies and table rows. */
const SECRET_KEYS = new Set([
  'password', 'currentPassword', 'newPassword', 'token', 'inviteToken', 'uploadToken', 'resetToken', 'mfaCode', 'mfaSecret',
  'mfa_secret', 'passwordHash', 'password_hash', 'tokenHash', 'token_hash', 'secret', 'otpauthUrl', 'qrDataUrl', 'hp',
]);
/** Only hidden in request bodies (a project row legitimately has a "code"). */
const BODY_SECRET_KEYS = new Set(['code']);
const LABEL_KEYS = ['reference_no', 'quote_no', 'code', 'title', 'name', 'email', 'from_path', 'original_filename', 'subject', 'question', 'slug'];
const IGNORE_IN_DIFF = new Set(['updated_at', 'created_at']);

type Row = Record<string, unknown>;

/** Recursively hides secrets and trims long values so a row stays small. */
export function sanitize(value: unknown, body = false, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 2000)}… (${value.length} chars)` : value;
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[file, ${value.length} bytes]`;
  if (depth > 4) return '[…]';
  if (Array.isArray(value)) {
    const items = value.slice(0, 50).map((v) => sanitize(v, body, depth + 1));
    return value.length > 50 ? [...items, `… ${value.length - 50} more`] : items;
  }
  const out: Row = {};
  for (const [k, v] of Object.entries(value as Row)) {
    out[k] = SECRET_KEYS.has(k) || (body && BODY_SECRET_KEYS.has(k)) ? '[hidden]' : sanitize(v, body, depth + 1);
  }
  return out;
}

/** Top-level primitive fields of a response (enough to identify what was created). */
function shallow(value: unknown): Row | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Row = {};
  for (const [k, v] of Object.entries(value as Row)) {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v) || v instanceof Date) out[k] = v;
  }
  return sanitize(out) as Row;
}

export function diff(before: Row | null, after: Row | null) {
  if (!before || !after) return [];
  const changes: { field: string; from: unknown; to: unknown }[] = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (IGNORE_IN_DIFF.has(field)) continue;
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes.push({ field, from: before[field] ?? null, to: after[field] ?? null });
  }
  return changes;
}

const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Row)[k] : undefined), obj);

const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'string' ? v.replace(/_/g, ' ') : String(v));

/**
 * Writes one audit_events row for every successful request that changes data (except sign-in / sign-out):
 * who (user, e-mail, role, IP, browser), what (action + readable sentence), which record (type, id, label,
 * project / lead / company), the record before and after, the request input and what the services reported.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Audit');

  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser; route?: { path?: string } }>();
    if (!MUTATING.has(req.method)) return next.handle();
    const routePath = (req.route?.path ?? req.path).replace(/^\/api(?=\/)/, '');
    const key = `${req.method} ${routePath}`;
    if (AUDIT_SKIP.has(key)) return next.handle();
    const spec: AuditRoute = AUDIT_ROUTES[key] ?? { action: `${req.method.toLowerCase()} ${routePath}`, entity: 'other', say: `${req.method} ${routePath}` };

    const ctx: AuditRequestContext = { events: [] };
    return new Observable((subscriber) => {
      void (async () => {
        const preId = this.recordId(spec, req, undefined);
        const before = spec.table && preId ? await this.snapshot(spec.table, preId).catch(() => null) : null;
        auditContext.run(ctx, () => {
          next
            .handle()
            .pipe(mergeMap(async (result: unknown) => {
              await this.record(spec, req, context.switchToHttp().getResponse<Response>(), ctx, before, preId, result).catch((err: Error) =>
                this.logger.error(`could not write audit row for ${key}: ${err.message}`),
              );
              return result;
            }))
            .subscribe(subscriber);
        });
      })().catch((err: unknown) => subscriber.error(err));
    });
  }

  private recordId(spec: AuditRoute, req: Request & { user?: AuthUser }, result: unknown): string | null {
    const id = spec.id;
    if (!id) return null;
    if (id === 'self') return req.user?.id ?? null;
    if (id === 'result') {
      const r = result as Row | undefined;
      return (r?.id as string) ?? ((r?.user as Row | undefined)?.id as string) ?? null;
    }
    if (id.startsWith('body.')) return (get(req.body, id.slice(5)) as string) ?? null;
    return (req.params?.[id] as string) ?? null;
  }

  private async snapshot(table: string, id: string): Promise<Row | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows: Row[] = await this.ds.query(`SELECT * FROM "${table}" WHERE id = $1`, [id]);
    return rows[0] ? (sanitize(rows[0]) as Row) : null;
  }

  /** project / lead / company the record belongs to, for "everything that happened on X" filters. */
  private async owners(entity: string, id: string | null, row: Row | null, req: Request) {
    const o: { projectId: string | null; inquiryId: string | null; companyId: string | null } = { projectId: (row?.project_id as string) ?? null, inquiryId: (row?.inquiry_id as string) ?? null, companyId: (row?.company_id as string) ?? null };
    if (entity === 'project') o.projectId = id;
    if (entity === 'inquiry') o.inquiryId = id;
    if (entity === 'company') o.companyId = id;
    if (!o.projectId && req.params?.id && /^\/api\/projects\/:id/.test((req as { route?: { path?: string } }).route?.path ?? '')) o.projectId = req.params.id as string;
    const lookups: [string, string][] = [];
    if (!o.projectId && row?.project_product_id) lookups.push([`SELECT project_id FROM project_products WHERE id = $1`, row.project_product_id as string]);
    if (!o.projectId && row?.sample_id) lookups.push([`SELECT pp.project_id FROM samples s JOIN project_products pp ON pp.id = s.project_product_id WHERE s.id = $1`, row.sample_id as string]);
    if (row?.document_id) lookups.push([`SELECT project_id, inquiry_id, company_id FROM documents WHERE id = $1`, row.document_id as string]);
    for (const [sql, param] of lookups) {
      const [r] = (await this.ds.query(sql, [param])) as Row[];
      if (!r) continue;
      o.projectId ??= (r.project_id as string) ?? null;
      o.inquiryId ??= (r.inquiry_id as string) ?? null;
      o.companyId ??= (r.company_id as string) ?? null;
    }
    if (o.projectId && !o.companyId) {
      const [p] = (await this.ds.query(`SELECT company_id FROM projects WHERE id = $1`, [o.projectId])) as Row[];
      o.companyId = (p?.company_id as string) ?? null;
    }
    if (o.inquiryId && !o.companyId) {
      const [i] = (await this.ds.query(`SELECT company_id FROM inquiries WHERE id = $1`, [o.inquiryId])) as Row[];
      o.companyId = (i?.company_id as string) ?? null;
    }
    return o;
  }

  private label(row: Row | null, result: unknown): string | null {
    for (const source of [row, result as Row | null]) {
      if (!source || typeof source !== 'object') continue;
      if (source.first_name || source.firstName) return [source.first_name ?? source.firstName, source.last_name ?? source.lastName].filter(Boolean).join(' ');
      for (const k of LABEL_KEYS) {
        const v = source[k] ?? source[k.replace(/_(\w)/g, (_, c: string) => c.toUpperCase())];
        if (typeof v === 'string' && v) return v.slice(0, 300);
      }
      if (typeof source.revision_no === 'number') return `#${source.revision_no}`;
    }
    return null;
  }

  private async userEmail(id: unknown): Promise<string> {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) return '—';
    const [u] = (await this.ds.query(`SELECT email FROM users WHERE id = $1`, [id])) as Row[];
    return (u?.email as string) ?? id;
  }

  private async record(
    spec: AuditRoute, req: Request & { user?: AuthUser }, res: Response, ctx: AuditRequestContext,
    before: Row | null, preId: string | null, result: unknown,
  ) {
    const id = preId ?? this.recordId(spec, req, result);
    const deleted = req.method === 'DELETE' && !!spec.table && !!id;
    const after = spec.table && id && !deleted ? await this.snapshot(spec.table, id).catch(() => null) : null;
    const row = after ?? before;

    // Who: the signed-in user, else the user a service named (accept invite / reset password), else a website visitor.
    let actorId = req.user?.id ?? null;
    let actorEmail = req.user?.email ?? null;
    let actorRole: string | null = req.user?.role ?? null;
    if (!actorId) {
      const named = ctx.events.find((e) => e.actorId)?.actorId;
      if (named) {
        const [u] = (await this.ds.query(`SELECT email, role FROM users WHERE id = $1`, [named])) as Row[];
        actorId = named;
        actorEmail = (u?.email as string) ?? null;
        actorRole = (u?.role as string) ?? null;
      }
    }
    // Website forms carry the visitor's e-mail; it is not an account, so actor_* stay empty.
    const visitorEmail = get(req.body, 'contact.email');
    const who = actorEmail ?? (typeof visitorEmail === 'string' ? `Website visitor (${visitorEmail})` : 'Website visitor');

    const label = this.label(row, result) ?? (spec.id === 'result' ? this.label(null, result) : null);
    let sentence = spec.say;
    for (const m of sentence.match(/\{user:\w+\}/g) ?? []) {
      const field = m.slice(6, -1);
      sentence = sentence.replace(m, await this.userEmail(get(req.body, field) ?? req.params?.[field]));
    }
    sentence = sentence
      .replace('{label}', label ?? 'a record')
      .replace(/\{b\.([\w.]+)\}/g, (_, p: string) => text(get(req.body, p)))
      .replace(/\{r\.([\w.]+)\}/g, (_, p: string) => text(get(result, p)));

    const owners = await this.owners(spec.entity, id, row, req);
    const isUpload = req.method === 'PUT';
    await this.audit.write({
      actorId, actorEmail, actorRole,
      action: spec.action,
      summary: `${who} ${sentence}`.slice(0, 2000),
      entityType: spec.entity,
      entityId: id && /^[0-9a-f-]{36}$/i.test(id) ? id : null,
      entityLabel: label,
      ...owners,
      before: deleted || req.method !== 'POST' || spec.id !== 'result' ? before : null,
      after,
      details: {
        input: isUpload ? '[file content]' : sanitize(req.body, true),
        changes: diff(before, after),
        ...(ctx.events.length ? { events: sanitize(ctx.events) } : {}),
        result: shallow(result),
      },
      method: req.method,
      path: req.originalUrl.split('?')[0].slice(0, 500),
      statusCode: res.statusCode,
      ip: clientIp(req),
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 500) || null,
    });
  }
}
