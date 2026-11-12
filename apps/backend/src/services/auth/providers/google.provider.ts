import { google } from 'googleapis';
import {
  AuthProvider,
  AuthProviderAbstract,
} from '@gitroom/backend/services/auth/providers.interface';

const defaultRedirect = () =>
  `${process.env.FRONTEND_URL}/integrations/social/youtube`;

// A redirect_uri from the caller is used only when it points back at this
// app; Google's allowlist is the real gate, this keeps the code from relying
// on it alone. Nothing in the web or mobile app sends one today.
export const safeRedirect = (candidate?: string) => {
  const own = process.env.FRONTEND_URL;
  if (!candidate || !own) return defaultRedirect();
  try {
    return new URL(candidate).origin === new URL(own).origin ? candidate : defaultRedirect();
  } catch {
    return defaultRedirect();
  }
};

// One verifier for the process: the client keeps Google's public keys until
// they expire, so a sign-in does not fetch them again (or fail when Google's
// key endpoint is slow) while the ones it has are still good.
let idTokenVerifier: InstanceType<typeof google.auth.OAuth2> | undefined;
export const googleIdTokenVerifier = () =>
  (idTokenVerifier ??= new google.auth.OAuth2());

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

  // The mobile app signs in with Google natively (Credential Manager on
  // Android, the Google Sign-In SDK on iOS) and sends the ID token it got.
  // Both SDKs are configured with the web client as the server client, so the
  // token's audience is that client on both platforms. Google's signature,
  // expiry and issuer are checked by the library; an unverified address is
  // refused. `sub` is the same id the web flow stores (userinfo `id`), so the
  // account found is the one made on the web.
  async verifyIdToken(
    idToken: string
  ): Promise<{ id: string; email: string } | false> {
    const audience = process.env.YOUTUBE_CLIENT_ID;
    if (!audience || !idToken) return false;
    try {
      const ticket = await googleIdTokenVerifier().verifyIdToken({
        idToken,
        audience,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        return false;
      }
      return { id: payload.sub, email: payload.email };
    } catch {
      return false;
    }
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
      // An address Google has not verified is not proof of owning it: it
      // must not claim a plan promised to that address.
      verified: data.verified_email !== false,
    };
  }
}
