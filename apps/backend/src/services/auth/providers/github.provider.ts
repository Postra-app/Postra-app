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

  // Only a token GitHub issued to this app: one the same person gave to any
  // other GitHub app answers "whose token is it" just as well, and it comes
  // in the request body. GitHub's own check takes this app's credentials,
  // so with none configured nothing signs in.
  private async issuedToThisApp(access_token: string) {
    const id = process.env.GITHUB_CLIENT_ID;
    const secret = process.env.GITHUB_CLIENT_SECRET;
    if (!id || !secret || !access_token) return false;
    try {
      const res = await fetch(
        `https://api.github.com/applications/${encodeURIComponent(id)}/token`,
        {
          method: 'POST',
          headers: {
            Authorization:
              'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ access_token }),
        }
      );
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async getUser(
    access_token: string
  ): Promise<{ email: string; id: string; verified: boolean } | false> {
    if (!(await this.issuedToThisApp(access_token))) return false;

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
