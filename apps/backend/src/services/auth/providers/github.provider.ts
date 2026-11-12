import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

@AuthProvider({ provider: 'GITHUB' })
export class GithubProvider extends AuthProviderAbstract {
  generateLink(_query?: any, state?: string): string {
    return `https://github.com/login/oauth/authorize?client_id=${
      process.env.GITHUB_CLIENT_ID
    }&scope=user:email&state=${state || ''}&redirect_uri=${encodeURIComponent(
      `${process.env.FRONTEND_URL}/settings`
    )}`;
  }

  async getToken(code: string, _redirectUri?: string): Promise<string> {
    const { access_token } = await (
      await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: `${process.env.FRONTEND_URL}/settings`,
        }),
      })
    ).json();

    return access_token;
  }

  async getUser(
    access_token: string
  ): Promise<{ email: string; id: string; verified: boolean }> {
    const data = await (
      await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${access_token}`,
        },
      })
    ).json();

    // The primary address if GitHub verified it, else any verified one; the
    // first in the list could be an address nobody confirmed owning.
    const emails: Array<{ email: string; primary?: boolean; verified?: boolean }> =
      await (
        await fetch('https://api.github.com/user/emails', {
          headers: {
            Authorization: `token ${access_token}`,
          },
        })
      ).json();
    const chosen =
      emails.find((e) => e.primary && e.verified) ??
      emails.find((e) => e.verified) ??
      emails[0];

    return {
      email: chosen?.email,
      id: String(data.id),
      verified: chosen?.verified === true,
    };
  }
}
