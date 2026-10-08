import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { OAuthService } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.service';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { User, Organization } from '@prisma/client';
import { AuthorizeOAuthQueryDto, ApproveOAuthDto } from '@gitroom/nestjs-libraries/dtos/oauth/authorize-oauth.dto';
import { TokenExchangeDto } from '@gitroom/nestjs-libraries/dtos/oauth/token-exchange.dto';
import { RegisterClientDto } from '@gitroom/nestjs-libraries/dtos/oauth/register-client.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// RFC 7636 §4.3: a challenge without a method means `plain`, which is not
// offered. Taking it as S256 would fail the exchange later with no reason.
const requireS256 = (params: {
  code_challenge?: string;
  code_challenge_method?: string;
}) => {
  if (params.code_challenge && params.code_challenge_method !== 'S256') {
    throw new HttpException(
      {
        error: 'invalid_request',
        error_description: 'code_challenge_method must be S256',
      },
      HttpStatus.BAD_REQUEST
    );
  }
};

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthController {
  constructor(private _oauthService: OAuthService) {}

  // Dynamic Client Registration (RFC 7591): how Claude, ChatGPT and other
  // MCP clients sign up before asking the person to approve them (upstream
  // eabac3d3d). Open by design, so throttled per address.
  @Post('/register')
  @HttpCode(201)
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  register(@Body() body: RegisterClientDto) {
    return this._oauthService.registerDynamicClient(body);
  }

  @Get('/authorize')
  async authorize(@Query() query: AuthorizeOAuthQueryDto) {
    requireS256(query);
    const app = await this._oauthService.validateAuthorizationRequest(
      query.client_id,
      { redirectUri: query.redirect_uri, codeChallenge: query.code_challenge }
    );

    return {
      app: {
        name: app.name,
        description: app.description,
        picture: app.picture,
        clientId: app.clientId,
        redirectUrl: this._oauthService.redirectTarget(app, query.redirect_uri),
        // The name of a dynamic client is whatever it registered with: the
        // consent screen says so.
        dynamic: app.dynamic,
      },
      state: query.state,
    };
  }

  @Post('/token')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async token(@Body() body: TokenExchangeDto) {
    if (body.grant_type !== 'authorization_code') {
      throw new HttpException(
        { error: 'unsupported_grant_type' },
        HttpStatus.BAD_REQUEST
      );
    }

    return this._oauthService.exchangeCodeForToken(
      body.code,
      body.client_id,
      body.client_secret,
      body.code_verifier,
      body.redirect_uri
    );
  }
}

@ApiTags('OAuth')
@Controller('/oauth')
export class OAuthAuthorizedController {
  constructor(private _oauthService: OAuthService) {}

  // An approved app acts as an admin of the organisation, so approving one is
  // for admins, like seeing the API key (E2E-08-25).
  @Post('/authorize')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async approveOrDeny(
    @Body() body: ApproveOAuthDto,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    requireS256(body);
    const app = await this._oauthService.validateAuthorizationRequest(
      body.client_id,
      { redirectUri: body.redirect_uri, codeChallenge: body.code_challenge }
    );
    const target = this._oauthService.redirectTarget(app, body.redirect_uri);

    if (body.action === 'deny') {
      const redirectUrl = new URL(target);
      redirectUrl.searchParams.set('error', 'access_denied');
      if (body.state) {
        redirectUrl.searchParams.set('state', body.state);
      }
      return { redirect: redirectUrl.toString() };
    }

    const code = await this._oauthService.createAuthorizationCode(
      app.id,
      user.id,
      org.id,
      body.code_challenge,
      app.dynamic ? body.redirect_uri : undefined
    );

    const redirectUrl = new URL(target);
    redirectUrl.searchParams.set('code', code);
    if (body.state) {
      redirectUrl.searchParams.set('state', body.state);
    }
    return { redirect: redirectUrl.toString() };
  }
}
