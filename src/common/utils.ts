import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/**
 * Visitor IP. Uses Express' req.ip, which honours `trust proxy` (main.ts) and takes the
 * address added by our own proxy (the Next.js frontend) – not the first X-Forwarded-For
 * entry, which a visitor could fake to dodge rate limits.
 */
export function clientIp(req: Request): string | null {
  return req.ip?.replace(/^::ffff:/, '') || null;
}

export function slugify(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 190);
}

export class PageQueryDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 25 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize = 25;
  @ApiPropertyOptional() @IsOptional() @IsString() q?: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const paged = <T>(items: T[], total: number, q: PageQueryDto): Paged<T> => ({
  items, total, page: q.page, pageSize: q.pageSize,
});

/** Escape a value for CSV output. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Guard against spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Deterministic JSON (sorted keys) so the same content always gives the same hash. */
export function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(',')}}`;
}
