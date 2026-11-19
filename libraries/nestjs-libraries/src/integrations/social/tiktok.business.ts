import { AuthService } from '@gitroom/helpers/auth/auth.service';

// First comment on TikTok. The Content Posting API a TikTok channel publishes
// with has no way to write a comment; TikTok API for Business has one
// (Accounts > Comments), and it is another app with another sign-in. A TikTok
// channel therefore keeps publishing as before and, when its owner turns
// first comment on, carries a second authorization that is used for comments
// only. Its tokens live encrypted in Integration.customInstanceDetails and the
// channel gets TIKTOK_COMMENT_SCOPE in grantedScopes, which is what the
// composer and the publish workflow read (comment.capability.ts).

export const TIKTOK_COMMENT_SCOPE = 'comment.list.manage';

// What the second authorization asks for: who the account is (to check it is
// the channel's account), its posts (the link of the commented post) and
// comments on its own posts.
export const TIKTOK_BUSINESS_SCOPES = [
  'user.info.basic',
  'user.info.username',
  'video.list',
  'comment.list',
  TIKTOK_COMMENT_SCOPE,
];

// TikTok's limit for the text of a comment.
export const TIKTOK_COMMENT_MAX_LENGTH = 1200;

const API = 'https://business-api.tiktok.com/open_api/v1.3';

// Refresh this long before the access token (one day) runs out.
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

export interface TiktokBusinessAccess {
  openId: string;
  accessToken: string;
  refreshToken: string;
  // Epoch milliseconds.
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export class TiktokBusinessError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
  }
}

export const tiktokBusinessConfigured = () =>
  !!process.env.TIKTOK_BUSINESS_APP_ID && !!process.env.TIKTOK_BUSINESS_SECRET;

// The app has one registered redirect address: TIKTOK_URL when set (another
// host), else the app. The TikTok channel's own sign-in always returns to the
// app (tiktokRedirectUri).
export const tiktokBusinessRedirectUri = () => {
  const base = process?.env?.TIKTOK_URL || process?.env?.FRONTEND_URL;
  return `${
    base?.indexOf('https') === -1 ? 'https://redirectmeto.com/' : ''
  }${base}/integrations/social/tiktok-business`;
};

export const tiktokBusinessAuthUrl = (state: string) =>
  'https://www.tiktok.com/v2/auth/authorize' +
  `?client_key=${process.env.TIKTOK_BUSINESS_APP_ID}` +
  `&scope=${encodeURIComponent(TIKTOK_BUSINESS_SCOPES.join(','))}` +
  `&response_type=code` +
  `&redirect_uri=${encodeURIComponent(tiktokBusinessRedirectUri())}` +
  `&state=${encodeURIComponent(state)}`;

// Every answer of the API is 200 with a code of its own; 0 is success.
const call = async (
  path: string,
  init: RequestInit,
  what: string
): Promise<any> => {
  const response = await fetch(`${API}${path}`, init);
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok || body?.code !== 0) {
    throw new TiktokBusinessError(
      `TikTok could not ${what} (${String(
        body?.message || response.status
      ).slice(0, 120)})`,
      typeof body?.code === 'number' ? body.code : undefined
    );
  }
  return body.data || {};
};

const json = (body: Record<string, unknown>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const toAccess = (
  data: any,
  now: number,
  before?: TiktokBusinessAccess
): TiktokBusinessAccess & { scopes: string[] } => {
  if (!data?.access_token || !(data?.open_id || before?.openId)) {
    throw new TiktokBusinessError('TikTok returned no access token');
  }
  const seconds = (value: unknown, fallback: number) => {
    const said = Number(value);
    return Number.isFinite(said) && said > 0 ? said : fallback;
  };
  return {
    openId: String(data.open_id || before!.openId),
    accessToken: String(data.access_token),
    refreshToken: String(data.refresh_token || before?.refreshToken || ''),
    accessExpiresAt: now + seconds(data.expires_in, 86400) * 1000,
    refreshExpiresAt: data.refresh_token_expires_in
      ? now + seconds(data.refresh_token_expires_in, 31536000) * 1000
      : before?.refreshExpiresAt || now + 31536000 * 1000,
    scopes: String(data.scope || '')
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean),
  };
};

export const tiktokBusinessExchangeCode = async (code: string) =>
  toAccess(
    await call(
      '/tt_user/oauth2/token/',
      json({
        client_id: process.env.TIKTOK_BUSINESS_APP_ID,
        client_secret: process.env.TIKTOK_BUSINESS_SECRET,
        grant_type: 'authorization_code',
        auth_code: code,
        redirect_uri: tiktokBusinessRedirectUri(),
      }),
      'finish the sign-in'
    ),
    Date.now()
  );

export const tiktokBusinessRefresh = async (before: TiktokBusinessAccess) =>
  toAccess(
    await call(
      '/tt_user/oauth2/refresh_token/',
      json({
        client_id: process.env.TIKTOK_BUSINESS_APP_ID,
        client_secret: process.env.TIKTOK_BUSINESS_SECRET,
        grant_type: 'refresh_token',
        refresh_token: before.refreshToken,
      }),
      'renew the access for comments'
    ),
    Date.now(),
    before
  );

const get = (
  path: string,
  access: Pick<TiktokBusinessAccess, 'accessToken'>,
  query: Record<string, string>,
  what: string
) =>
  call(
    `${path}?${new URLSearchParams(query).toString()}`,
    { method: 'GET', headers: { 'Access-Token': access.accessToken } },
    what
  );

// The @username of the account that authorized, to compare with the channel.
export const tiktokBusinessUsername = async (
  access: Pick<TiktokBusinessAccess, 'accessToken' | 'openId'>
): Promise<string> => {
  const data = await get(
    '/business/get/',
    access,
    { business_id: access.openId, fields: JSON.stringify(['username']) },
    'read the account'
  );
  return String(data?.username || '');
};

// The link TikTok gives for one of the account's own public posts; undefined
// when TikTok does not list the post (private, or still being reviewed).
export const tiktokBusinessPostLink = async (
  access: Pick<TiktokBusinessAccess, 'accessToken' | 'openId'>,
  videoId: string
): Promise<string | undefined> => {
  const data = await get(
    '/business/video/list/',
    access,
    {
      business_id: access.openId,
      fields: JSON.stringify(['item_id', 'share_url']),
      filters: JSON.stringify({ video_ids: [videoId] }),
    },
    'read the post'
  );
  const found = (data?.videos || []).find(
    (video: any) => String(video?.item_id) === videoId
  );
  // Without TikTok's tracking parameters, which also name our app.
  return found?.share_url ? String(found.share_url).split('?')[0] : undefined;
};

export const tiktokBusinessCreateComment = async (
  access: Pick<TiktokBusinessAccess, 'accessToken' | 'openId'>,
  videoId: string,
  text: string
): Promise<string> => {
  const data = await call(
    '/business/comment/create/',
    {
      method: 'POST',
      headers: {
        'Access-Token': access.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_id: access.openId,
        video_id: videoId,
        text,
      }),
    },
    'publish the comment'
  );
  if (!data?.comment_id) {
    throw new TiktokBusinessError('TikTok returned no comment id');
  }
  return String(data.comment_id);
};

export const sealTiktokBusinessAccess = (access: TiktokBusinessAccess) =>
  AuthService.encryptSecret(
    JSON.stringify({
      tiktokBusiness: {
        openId: access.openId,
        accessToken: access.accessToken,
        refreshToken: access.refreshToken,
        accessExpiresAt: access.accessExpiresAt,
        refreshExpiresAt: access.refreshExpiresAt,
      },
    })
  );

export const openTiktokBusinessAccess = (
  sealed?: string | null
): TiktokBusinessAccess | undefined => {
  if (!sealed) {
    return undefined;
  }
  try {
    const access = JSON.parse(AuthService.decryptSecret(sealed))
      ?.tiktokBusiness;
    return access?.accessToken && access?.openId ? access : undefined;
  } catch {
    return undefined;
  }
};

export const tiktokBusinessNeedsRefresh = (
  access: TiktokBusinessAccess,
  now = Date.now()
) => access.accessExpiresAt - REFRESH_MARGIN_MS <= now;

// Same account, whatever the case and with or without the leading @.
export const sameTiktokAccount = (a?: string | null, b?: string | null) => {
  const clean = (value?: string | null) =>
    String(value || '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
  return !!clean(a) && clean(a) === clean(b);
};
