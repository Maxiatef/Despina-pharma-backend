import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CompanyMembership, Session, User } from '../../database/entities/index.js';
import { AuthService } from './auth.service.js';
import { AuthGuard } from './auth.guard.js';
import { AuthController } from './auth.controller.js';
import { SessionsController } from './sessions.controller.js';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([User, Session, CompanyMembership])],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  controllers: [AuthController, SessionsController],
  exports: [AuthService],
})
export class AuthModule {}
