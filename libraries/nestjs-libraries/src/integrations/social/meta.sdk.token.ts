import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/meta.graph.version';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';

// Meta user tokens are opaque, alphanumeric and a few hundred characters long.
const TOKEN_SHAPE = /^[A-Za-z0-9]{20,1024}$/;

/**
 * A user token from the Facebook Login SDK in the mobile app arrives from the
 * phone, so it proves nothing on its own: it could have been issued to any
 * other Meta app (whose owner then gets our long-lived token and the user's
 * Pages through us), or be expired, or be a Page or app token. Meta's
 * debug_token, asked with our own app token, answers all of that.
 *
 * Returns the Facebook user id the token belongs to. A rejection is a
 * NotEnoughScopes, so the connect route shows its message to the user.
 */
export async function verifyMetaSdkToken(token: string): Promise<string> {
  if (typeof token !== 'string' || !TOKEN_SHAPE.test(token)) {
    throw new NotEnoughScopes('This Facebook sign-in is not valid.');
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    throw new NotEnoughScopes('Facebook sign-in is not configured.');
  }

  const response = await fetch(
    `https://graph.facebook.com/${META_GRAPH_API_VERSION}/debug_token` +
      `?input_token=${encodeURIComponent(token)}` +
      `&access_token=${encodeURIComponent(`${appId}|${appSecret}`)}`
  );
  const body: any = await response.json().catch(() => ({}));
  const data = body?.data;

  if (
    !response.ok ||
    !data ||
    data.is_valid !== true ||
    String(data.app_id) !== String(appId) ||
    data.type !== 'USER' ||
    !data.user_id
  ) {
    throw new NotEnoughScopes(
      'This Facebook sign-in was not issued for Postra. Please try again.'
    );
  }

  return String(data.user_id);
}

/** Exchanges a short-lived Meta user token for a long-lived one. */
export async function exchangeMetaUserToken(token: string): Promise<string> {
  const { access_token } = await (
    await fetch(
      `https://graph.facebook.com/${META_GRAPH_API_VERSION}/oauth/access_token` +
        '?grant_type=fb_exchange_token' +
        `&client_id=${process.env.FACEBOOK_APP_ID}` +
        `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
        `&fb_exchange_token=${encodeURIComponent(token)}`
    )
  ).json();
  if (!access_token) {
    throw new NotEnoughScopes(
      'Facebook did not accept this sign-in. Please try again.'
    );
  }
  return access_token;
}
