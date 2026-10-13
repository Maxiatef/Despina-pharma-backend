import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AppSetting } from '../../database/entities/index.js';

/**
 * Admin-editable settings (app_settings). Read often (every e-mail), written rarely, so values are cached
 * for a few seconds per instance; a write clears the cache on that instance immediately.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, string | null>();
  private loadedAt = 0;
  private static readonly TTL_MS = 15_000;

  constructor(@InjectRepository(AppSetting) private readonly repo: Repository<AppSetting>) {}

  private async all(): Promise<Map<string, string | null>> {
    if (Date.now() - this.loadedAt < SettingsService.TTL_MS) return this.cache;
    const rows = await this.repo.find();
    this.cache = new Map(rows.map((r) => [r.key, r.value]));
    this.loadedAt = Date.now();
    return this.cache;
  }

  /** The stored value, or undefined when it was never set (callers then use their .env fallback). */
  async get(key: string): Promise<string | null | undefined> {
    const all = await this.all();
    return all.has(key) ? all.get(key) : undefined;
  }

  /** Unset or anything but "false" = on. */
  async isOn(key: string) {
    return (await this.get(key)) !== 'false';
  }

  async getMany(keys: Iterable<string>) {
    const all = await this.all();
    return Object.fromEntries([...keys].map((k) => [k, all.has(k) ? all.get(k) ?? null : null]));
  }

  async rows(keys: string[]) {
    return this.repo.find({ where: { key: In(keys) } });
  }

  async set(patch: Record<string, string | null>, actorId: string | null) {
    for (const [key, value] of Object.entries(patch)) {
      await this.repo.save(this.repo.create({ key, value, updatedBy: actorId }));
    }
    this.loadedAt = 0;
  }
}
