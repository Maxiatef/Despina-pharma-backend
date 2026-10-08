import { AsyncLocalStorage } from 'node:async_hooks';

/** What the services report while a request runs; AuditInterceptor turns it into one audit row at the end. */
export interface AuditServiceEvent {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface AuditRequestContext {
  events: AuditServiceEvent[];
}

export const auditContext = new AsyncLocalStorage<AuditRequestContext>();
