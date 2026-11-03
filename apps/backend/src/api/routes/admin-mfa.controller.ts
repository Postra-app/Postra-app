import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import {
  AdminMfaService,
  AdminMfaUser,
  isAdministrator,
} from '@gitroom/backend/services/auth/admin-mfa.service';
import { setSessionCookie } from '@gitroom/backend/services/auth/session.cookie';

// A code is a short string. Anything else in the body (an object with a
// broken toString, an array) is a bad request, not a 500.
export const codeOf = (code: unknown): string => {
  if (typeof code !== 'string' || code.length > 64) {
    throw new HttpException('Type the code from your authenticator app', 400);
  }
  return code;
};

// The second step of an administrator's sign-in (admin-mfa.ts). Every route
// is for Postra administrators only and needs a session (auth.middleware
// runs in front of this controller). Not under /admin: that prefix is closed
// to a session without the second step, which is what this is for.
@ApiTags('Admin two-factor')
@Controller('/two-factor')
export class AdminMfaController {
  constructor(
    private _adminMfa: AdminMfaService,
    private _authService: AuthService
  ) {}

  @Get('/')
  status(@GetUserFromRequest() user: AdminMfaUser) {
    return this._adminMfa.status(user);
  }

  @Post('/setup')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  setup(@GetUserFromRequest() user: AdminMfaUser) {
    this.assertAdministrator(user);
    return this._adminMfa.setup(user);
  }

  @Post('/enable')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  async enable(
    @GetUserFromRequest() user: AdminMfaUser,
    @Body('code') code: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    this.assertAdministrator(user);
    const { backupCodes } = await this._adminMfa.enable(user, codeOf(code));
    this.elevate(req, res);
    return { verified: true, backupCodes };
  }

  @Post('/verify')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  async verify(
    @GetUserFromRequest() user: AdminMfaUser,
    @Body('code') code: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ) {
    this.assertAdministrator(user);
    const { backupCodesLeft } = await this._adminMfa.verify(user, codeOf(code));
    this.elevate(req, res);
    return { verified: true, backupCodesLeft };
  }

  private assertAdministrator(user: AdminMfaUser) {
    if (!isAdministrator(user)) {
      throw new ForbiddenException('Only Postra administrators can do this');
    }
  }

  // The session the request came with, reissued with the second factor.
  private elevate(req: Request, res: Response) {
    const current = (req.headers.auth as string) || req.cookies?.auth;
    if (!current) {
      throw new HttpException('No session', 401);
    }
    const jwt = this._authService.adminMfaJwt(current);
    setSessionCookie(res, jwt);
    if (process.env.NOT_SECURED) {
      res.header('auth', jwt);
    }
  }
}
