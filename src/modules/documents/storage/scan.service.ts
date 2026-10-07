import { Injectable, Logger } from '@nestjs/common';
import type { ScanStatus } from '../../../common/enums.js';

/**
 * Virus scanning hook.
 * TODO(scan): connect ClamAV (or the storage provider's malware scanning).
 * Until then: SCAN_MODE=skip marks files clean (dev only), SCAN_MODE=manual keeps
 * them "pending" so staff must release them before anyone can download.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger('Scan');

  async scan(_data: Buffer): Promise<ScanStatus> {
    const mode = process.env.SCAN_MODE ?? 'manual';
    if (mode === 'skip') return 'clean';
    this.logger.warn('No virus scanner configured; file left as pending (SCAN_MODE=manual)');
    return 'pending';
  }
}
