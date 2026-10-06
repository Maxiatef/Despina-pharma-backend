import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EmailService } from './email.service.js';
import { StaffOnly } from '../../common/decorators/auth.decorators.js';
import { paged } from '../../common/utils.js';
import { EmailJobQueryDto } from './dto/email-job-query.dto.js';

@ApiTags('email')
@ApiBearerAuth()
@StaffOnly()
@Controller('email-jobs')
export class EmailJobsController {
  constructor(private readonly email: EmailService) {}

  @Get()
  async list(@Query() q: EmailJobQueryDto) {
    const [items, total] = await this.email.list(q, (q.page - 1) * q.pageSize, q.pageSize);
    return paged(items, total, q);
  }

  @Get(':id/events')
  events(@Param('id', ParseUUIDPipe) id: string) {
    return this.email.eventsFor(id);
  }

  @Post(':id/retry')
  @HttpCode(200)
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.email.retry(id);
  }
}
