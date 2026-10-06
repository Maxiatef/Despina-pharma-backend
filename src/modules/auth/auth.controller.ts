import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './auth.guard.js';
import { CurrentUser, Public } from '../../common/decorators/auth.decorators.js';
import type { AuthUser } from '../../common/decorators/auth.decorators.js';
import { clientIp } from '../../common/utils.js';
import { RateLimitService } from '../rate-limit/rate-limit.service.js';
import { EmailService } from '../email/email.service.js';
import { LoginDto, TokenPasswordDto, ChangePasswordDto, CodeDto, ForgotDto } from './dto/auth.dto.js';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly rateLimit: RateLimitService,
    private readonly email: EmailService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ip = clientIp(req);
    await this.rateLimit.hit(`login:${ip}`, 10, 300);
    await this.rateLimit.hit(`login:${dto.email.toLowerCase()}`, 10, 300);
    const result = await this.auth.login(dto.email, dto.password, dto.mfaCode, ip, req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: result.expiresAt,
    });
    return result;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.sessionId);
    res.clearCookie(SESSION_COOKIE);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }

  @Post('mfa/setup')
  mfaSetup(@CurrentUser() user: AuthUser) {
    return this.auth.mfaSetup(user.id);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  mfaEnable(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    return this.auth.mfaEnable(user.id, dto.code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  mfaDisable(@CurrentUser() user: AuthUser, @Body() dto: CodeDto) {
    return this.auth.mfaDisable(user.id, dto.code);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(200)
  acceptInvite(@Body() dto: TokenPasswordDto) {
    return this.auth.setPasswordWithToken(dto.token, 'invite', dto.password);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(200)
  async forgot(@Body() dto: ForgotDto, @Req() req: Request) {
    await this.rateLimit.hit(`forgot:${clientIp(req)}`, 5, 900);
    const user = await this.auth.findUserByEmail(dto.email);
    if (user?.isActive) {
      const token = await this.auth.createSignedToken(user.id, 'reset', 2);
      await this.email.queue({ kind: 'password_reset', to: user.email, template: 'password_reset', data: { token } });
    }
    // Same answer whether or not the email exists.
    return { ok: true };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(200)
  reset(@Body() dto: TokenPasswordDto) {
    return this.auth.setPasswordWithToken(dto.token, 'reset', dto.password);
  }

  @Post('password/change')
  @HttpCode(200)
  change(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(user.id, dto.currentPassword, dto.newPassword);
  }
}
