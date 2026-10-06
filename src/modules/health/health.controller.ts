import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { Public } from '../../common/decorators/auth.decorators.js';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  /** GET /api/health – checks the API and the database connection. */
  @Public()
  @Get('health')
  async health() {
    await this.ds.query('SELECT 1');
    return { status: 'ok', time: new Date().toISOString() };
  }
}
