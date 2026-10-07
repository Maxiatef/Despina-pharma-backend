import { Injectable } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Private file storage. Files are kept OUTSIDE the public website and only served
 * through short-lived signed links.
 *
 * Current driver: local disk (STORAGE_DIR).
 * TODO(storage): add an S3/R2 driver (STORAGE_DRIVER=s3) for production with
 * pre-signed upload/download URLs.
 */
@Injectable()
export class StorageService {
  // Vercel only allows writing to /tmp, which is NOT kept between requests/instances.
  // TODO(storage): use S3/R2 in production so uploaded files are kept.
  private readonly root = resolve(process.env.STORAGE_DIR ?? (process.env.VERCEL ? '/tmp/despina-storage' : './storage'));

  private pathFor(key: string) {
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root)) throw new Error('Invalid storage key');
    return full;
  }

  async put(key: string, data: Buffer) {
    const p = this.pathFor(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, data, { flag: 'wx' });
  }

  async exists(key: string) {
    return stat(this.pathFor(key)).then(() => true, () => false);
  }

  read(key: string) {
    return createReadStream(this.pathFor(key));
  }

  async remove(key: string) {
    await unlink(this.pathFor(key)).catch(() => undefined);
  }
}
