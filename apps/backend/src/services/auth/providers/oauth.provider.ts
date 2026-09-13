import { NotFoundException } from '@nestjs/common';
import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GENERIC' })
export class OauthProvider extends AuthProviderAbstract {
  private getConfig() {
    const {
      POSTRA_OAUTH_AUTH_URL,
      POSTRA_OAUTH_CLIENT_ID,
      POSTRA_OAUTH_CLIENT_SECRET,
      POSTRA_OAUTH_TOKEN_URL,
      POSTRA_OAUTH_USERINFO_URL,
      FRONTEND_URL,
    } = process.env;

    const oauthVars = [
      POSTRA_OAUTH_AUTH_URL,
      POSTRA_OAUTH_CLIENT_ID,
      POSTRA_OAUTH_CLIENT_SECRET,
      POSTRA_OAUTH_TOKEN_URL,
      POSTRA_OAUTH_USERINFO_URL,
    ];

    // Two different situations that used to collapse into one 500.
    //
    // Nothing set at all means generic OAuth is simply not enabled here — we
    // run without it, and the frontend hides the button behind
    // POSTRA_GENERIC_OAUTH. The endpoint should then read as absent rather than
    // broken, so it answers 404 and files nothing in Sentry.
    if (oauthVars.every((v) => !v)) {
      throw new NotFoundException('Generic OAuth is not enabled');
    }

    // A half-filled set is the opposite case: someone meant to turn this on and
    // missed a variable. That stays a loud 500 with a Sentry issue, because
    // silently 404-ing it would hide a real misconfiguration.
    if (oauthVars.some((v) => !v) || !FRONTEND_URL) {
      throw new Error('POSTRA_OAUTH environment variables are not set');
    }

    return {
      authUrl: POSTRA_OAUTH_AUTH_URL,
      clientId: POSTRA_OAUTH_CLIENT_ID,
      clientSecret: POSTRA_OAUTH_CLIENT_SECRET,
      tokenUrl: POSTRA_OAUTH_TOKEN_URL,
      userInfoUrl: POSTRA_OAUTH_USERINFO_URL,
      frontendUrl: FRONTEND_URL,
    };
  }

  generateLink(_query?: any, state?: string): string {
    const { authUrl, clientId, frontendUrl } = this.getConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      scope: 'openid profile email',
      response_type: 'code',
      ...(state ? { state } : {}),
      redirect_uri: `${frontendUrl}/settings`,
    });

    return `${authUrl}?${params.toString()}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { tokenUrl, clientId, clientSecret, frontendUrl } = this.getConfig();
    const response = await fetch(`${tokenUrl}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: `${frontendUrl}/settings`,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token request failed: ${error}`);
    }

    const { access_token } = await response.json();
    return access_token;
  }

  async getUser(access_token: string): Promise<{ email: string; id: string }> {
    const { userInfoUrl } = this.getConfig();
    const response = await fetch(`${userInfoUrl}`, {
      headers: {
        Authorization: `Bearer ${access_token}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`User info request failed: ${error}`);
    }

    const { email, sub: id } = await response.json();
    return { email, id };
  }
}
