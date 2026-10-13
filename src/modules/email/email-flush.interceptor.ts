import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, mergeMap } from 'rxjs';
import { emailRequestContext } from './email-context.js';
import { EmailService } from './email.service.js';

/**
 * Sends the e-mails a request queued as soon as it has succeeded (its transaction is committed by then),
 * before the response goes out – on Vercel the function may stop right after responding.
 * A failed send never fails the request: the job stays "failed" and the queue retries it.
 */
@Injectable()
export class EmailFlushInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Email');

  constructor(private readonly email: EmailService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const store = { jobIds: [] as string[] };
    return new Observable((subscriber) =>
      emailRequestContext.run(store, () =>
        next
          .handle()
          .pipe(mergeMap(async (result: unknown) => {
            if (store.jobIds.length) {
              await this.email.sendNow(store.jobIds).catch((err: Error) => this.logger.error(`send after request failed: ${err.message}`));
            }
            return result;
          }))
          .subscribe(subscriber),
      ),
    );
  }
}
