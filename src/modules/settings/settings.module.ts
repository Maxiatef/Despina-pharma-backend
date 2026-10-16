import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppSetting } from '../../database/entities/index.js';
import { SettingsService } from './settings.service.js';
import { WorkRulesController } from './work-rules.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AppSetting])],
  controllers: [WorkRulesController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
