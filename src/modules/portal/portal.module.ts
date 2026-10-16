import { Module } from '@nestjs/common';
import { PortalService } from './portal.service.js';
import { TeamService } from './team.service.js';
import { PortalController } from './portal.controller.js';

@Module({
  providers: [PortalService, TeamService],
  controllers: [PortalController],
})
export class PortalModule {}
