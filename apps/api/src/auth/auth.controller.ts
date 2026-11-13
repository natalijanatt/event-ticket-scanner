import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  updateProfileSchema,
  type AppConfigDto,
  type AuthUser,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type UpdateProfileInput,
} from '@event-platform/shared';
import type { CookieOptions, Request, Response } from 'express';
import { zod } from '../common/zod-validation.pipe';
import { AppConfig } from '../config/app-config';
import { AuthService, type IssuedTokens } from './auth.service';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH, type RequestUser } from './auth.types';
import { CurrentUser, Public } from './decorators';

/** Strict limit for credential endpoints (per IP). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(zod(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthUser> {
    const { tokens, user } = await this.auth.login(body.email, body.password, req.headers['user-agent']);
    this.setCookies(res, tokens);
    return user;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<{ ok: true }> {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], req.headers['user-agent']);
      this.setCookies(res, tokens);
      return { ok: true };
    } catch (err) {
      if ((err as { code?: string }).code === 'SESSION_EXPIRED') this.clearCookies(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: RequestUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true }> {
    await this.auth.logout(user, req.cookies?.[REFRESH_COOKIE]);
    this.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() user: RequestUser): Promise<AuthUser> {
    return this.auth.profile(user.id);
  }

  @Patch('me')
  updateMe(@CurrentUser() user: RequestUser, @Body(zod(updateProfileSchema)) body: UpdateProfileInput): Promise<AuthUser> {
    return this.auth.updateProfile(user.id, body);
  }

  @Get('config')
  appConfig(): AppConfigDto {
    return { emailMode: this.config.emailMode, timezone: this.config.timezone };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body(zod(forgotPasswordSchema)) body: ForgotPasswordInput): Promise<{ ok: true }> {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body(zod(resetPasswordSchema)) body: ResetPasswordInput): Promise<{ ok: true }> {
    await this.auth.resetPassword(body.token, body.password);
    return { ok: true };
  }

  @Throttle(AUTH_THROTTLE)
  @Post('change-password')
  @HttpCode(200)
  async changePassword(
    @CurrentUser() user: RequestUser,
    @Body(zod(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<{ ok: true }> {
    await this.auth.changePassword(user, body);
    return { ok: true };
  }

  private baseCookie(): CookieOptions {
    return { httpOnly: true, secure: this.config.cookieSecure };
  }

  private setCookies(res: Response, tokens: IssuedTokens): void {
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.baseCookie(),
      sameSite: 'lax',
      path: '/',
      maxAge: tokens.accessMaxAgeMs,
    });
    // The refresh token is only ever sent to the auth endpoints.
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.baseCookie(),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: tokens.refreshMaxAgeMs,
    });
  }

  private clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { ...this.baseCookie(), sameSite: 'lax', path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.baseCookie(), sameSite: 'strict', path: REFRESH_COOKIE_PATH });
  }
}
