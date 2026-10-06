import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Fixed-window rate limiter stored in the rate_limits table, so limits hold
 * across several server instances. Used for public form submissions and login.
 */
@Injectable()
export class RateLimitService {
  constructor(private readonly ds: DataSource) {}

  async hit(key: string, limit: number, windowSeconds: number) {
    const windowMs = windowSeconds * 1000;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
    const rows: { count: number }[] = await this.ds.query(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, $2, 1)
       ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
       RETURNING count`,
      [key, windowStart],
    );
    if (rows[0].count > limit) {
      throw new HttpException('Too many requests, please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  /** Remove windows older than a day. */
  async cleanup() {
    await this.ds.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  }
}
