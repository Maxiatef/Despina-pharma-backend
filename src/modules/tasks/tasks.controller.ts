import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, StaffOnly } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { TasksService } from './tasks.service.js';
import { AssignTaskDto, CreateTaskDto, TaskQueryDto, UpdateTaskDto } from './dto/task.dto.js';

@ApiTags('tasks (staff)')
@ApiBearerAuth()
@StaffOnly()
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get() list(@Query() q: TaskQueryDto, @CurrentUser() u: AuthUser) { return this.tasks.list(q, u); }
  @Post() create(@Body() dto: CreateTaskDto, @CurrentUser() u: AuthUser) { return this.tasks.create(dto, u); }
  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto) { return this.tasks.update(id, dto); }
  @Post(':id/assign') @HttpCode(200) assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignTaskDto, @CurrentUser() u: AuthUser) {
    return this.tasks.assign(id, dto.userId ?? null, u);
  }
  @Post(':id/complete') @HttpCode(200) complete(@Param('id', ParseUUIDPipe) id: string) { return this.tasks.setDone(id, true); }
  @Post(':id/reopen') @HttpCode(200) reopen(@Param('id', ParseUUIDPipe) id: string) { return this.tasks.setDone(id, false); }
  @Delete(':id') remove(@Param('id', ParseUUIDPipe) id: string) { return this.tasks.remove(id); }
  @Post('send-overdue-digest') @HttpCode(200) digest() { return this.tasks.sendOverdueDigest(); }
}
