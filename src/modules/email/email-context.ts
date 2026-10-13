import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * E-mails queued while a request runs are sent as soon as the request has succeeded (EmailFlushInterceptor),
 * after the caller's transaction is committed. On Vercel there is no background process, so without this
 * a queued e-mail would wait for the daily cron. The queue still retries anything that failed.
 */
export const emailRequestContext = new AsyncLocalStorage<{ jobIds: string[] }>();
