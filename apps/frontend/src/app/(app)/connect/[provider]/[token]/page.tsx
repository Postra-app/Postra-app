import { Metadata } from 'next';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { capitalize } from 'lodash';
import { getT } from '@gitroom/react/translation/get.translation.service.backend';
import { ConnectInviteClient } from '@gitroom/frontend/components/launches/connect.invite.client';

// The invite token lives in Redis for an hour — nothing here can be cached.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Postra — connect a channel',
  description: '',
};

type Invite = { organization: string | null };

/**
 * Checks an invite token and finds who sent it. Returns null when the backend
 * cannot answer (it is unreachable for a minute or two on every deploy —
 * single EC2, no blue-green) so a transient 502 reads as "try again" rather than
 * as an expired link, and undefined when the token is genuinely gone.
 */
const loadInvite = async (
  token: string
): Promise<Invite | null | undefined> => {
  try {
    const response = await internalFetch(`/integrations/invite/${token}`);
    if (response.status >= 500) {
      // eslint-disable-next-line no-console
      console.error(`[Postra:invite] /integrations/invite -> ${response.status}`);
      return null;
    }
    const body = await response.json().catch(() => null);
    return body?.valid
      ? { organization: body.organization || null }
      : undefined;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[Postra:invite] lookup failed', e);
    return null;
  }
};

export default async function ConnectInvitePage(props: {
  params: Promise<{ provider: string; token: string }>;
}) {
  const { provider, token } = await props.params;
  const t = await getT();
  const invite = await loadInvite(token);
  const providerName = capitalize(provider.split('-')[0]);

  return (
    <div className="bg-primary min-h-screen flex items-center justify-center p-[20px]">
      <div className="w-full max-w-[560px] flex flex-col gap-[20px] launches-modal-surface text-textColor rounded-[16px] p-[24px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] uppercase tracking-[0.08em] text-customColor18">
            Postra
          </div>
          <h1 className="text-[20px] font-[600]">
            {invite?.organization
              ? t(
                  'connect_invite_title_from',
                  '{{organization}} invited you to connect {{provider}}',
                  { organization: invite.organization, provider: providerName }
                )
              : t('connect_invite_title', 'Connect {{provider}}', {
                  provider: providerName,
                })}
          </h1>
        </div>
        {invite ? (
          <ConnectInviteClient
            provider={provider}
            providerName={providerName}
            token={token}
          />
        ) : (
          <p className="text-[14px] text-textColor/80">
            {invite === null
              ? t(
                  'connect_invite_unavailable',
                  'We could not reach the server just now. Refresh the page in a minute and the link will work again.'
                )
              : t(
                  'connect_invite_expired',
                  'This invite link has expired — they are valid for one hour. Ask whoever sent it for a fresh one.'
                )}
          </p>
        )}
      </div>
    </div>
  );
}
