import { google } from 'googleapis';
import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/integrations/social/youtube`;

// A redirect_uri from the caller is used only when it points back at this
// app; Google's allowlist is the real gate, this keeps the code from relying
// on it alone (E2E-03-02). Nothing in the web or mobile app sends one today.
export const safeRedirect = (candidate?: string) => {
  const own = process.env.FRONTEND_URL;
  if (!candidate || !own) return defaultRedirect();
  try {
    return new URL(candidate).origin === new URL(own).origin ? candidate : defaultRedirect();
  } catch {
    return defaultRedirect();
  }
};

const makeClient = (redirectUri: string) =>
  new google.auth.OAuth2({
    clientId: process.env.YOUTUBE_CLIENT_ID,
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET,
    redirectUri,
  });

@AuthProvider({ provider: 'GOOGLE' })
export class GoogleProvider extends AuthProviderAbstract {
  generateLink(query?: { redirect_uri?: string }, state?: string) {
    const redirectUri = safeRedirect(query?.redirect_uri);
    return makeClient(redirectUri).generateAuthUrl({
      access_type: 'online',
      prompt: 'consent',
      state,
      redirect_uri: redirectUri,
      scope: [
        'https://www.googleapis.com/auth/userinfo.profile',
        'https://www.googleapis.com/auth/userinfo.email',
      ],
    });
  }

  async getToken(code: string, redirectUri?: string) {
    const client = makeClient(safeRedirect(redirectUri));
    const { tokens } = await client.getToken(code);
    return tokens.access_token!;
  }

  async getUser(providerToken: string) {
    const client = makeClient(defaultRedirect());
    client.setCredentials({ access_token: providerToken });
    const { data } = await google
      .oauth2({ version: 'v2', auth: client })
      .userinfo.get();

    return {
      id: data.id!,
      email: data.email!,
    };
  }
}
