'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { announceOrgChange } from '@gitroom/frontend/components/layout/org.broadcast';

type Preview =
  | { valid: false }
  | { valid: true; organization: string; role: 'USER' | 'ADMIN'; email: string };

// Opening an invitation link used to add the signed-in person at once — any
// page could send them there and drag them into its organisation, and they
// never saw which account joined (E2E-08-34). Now they are asked.
export const JoinOrganization = () => {
  const fetch = useFetch();
  const t = useT();
  const org = useSearchParams().get('org');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [joining, setJoining] = useState(false);
  const [refused, setRefused] = useState<boolean | 'no_seats'>(false);

  useEffect(() => {
    if (!org) {
      setPreview({ valid: false });
      return;
    }
    fetch(`/user/invite-preview?org=${encodeURIComponent(org)}`)
      .then((res) => res.json())
      .then(setPreview)
      .catch(() => setPreview({ valid: false }));
  }, [org]);

  const join = useCallback(async () => {
    setJoining(true);
    try {
      const { id, reason } = await (
        await fetch('/user/join-org', {
          method: 'POST',
          body: JSON.stringify({ org }),
        })
      ).json();
      if (!id) {
        setRefused(reason === 'no_seats' ? 'no_seats' : true);
        return;
      }
      await fetch('/user/change-org', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      announceOrgChange(id);
      window.location.href = '/launches';
    } catch {
      setRefused(true);
    } finally {
      setJoining(false);
    }
  }, [org]);

  if (!preview) {
    return <LoadingComponent />;
  }

  const back = (
    <Link href="/launches" className="underline underline-offset-4 hover:text-[#38bdf8]">
      {t('back_to_calendar', 'Back to the calendar')}
    </Link>
  );

  if (!preview.valid || refused) {
    return (
      <div className="mx-auto mt-[80px] max-w-[440px] rounded-[16px] border border-white/8 bg-white/[0.03] p-[24px] text-textColor/78">
        <p className="mb-[12px]">
          {refused === 'no_seats'
            ? t(
                'invitation_no_seats',
                'This workspace has no free seats on its plan. Ask its owner to free a seat or upgrade the plan, then open the invitation again.'
              )
            : t(
                'invitation_invalid',
                'This invitation has expired, was already used, or you are already a member.'
              )}
        </p>
        {back}
      </div>
    );
  }

  return (
    <div className="mx-auto mt-[80px] max-w-[440px] rounded-[16px] border border-white/8 bg-white/[0.03] p-[24px] text-textColor">
      <h1 className="mb-[12px] text-[20px] font-semibold">
        {t('join_organization_title', 'Join {{organization}}?', {
          organization: preview.organization,
        })}
      </h1>
      <p className="mb-[8px] text-textColor/78">
        {preview.role === 'ADMIN'
          ? t('join_as_admin', 'You were invited as an admin.')
          : t('join_as_member', 'You were invited as a team member.')}
      </p>
      <p className="mb-[20px] text-textColor/78">
        {t('join_with_account', 'You will join with {{email}}.', {
          email: preview.email,
        })}
      </p>
      <div className="flex gap-[12px]">
        <button
          type="button"
          onClick={join}
          disabled={joining}
          className="rounded-[8px] bg-[#38bdf8] px-[18px] py-[10px] font-medium text-[#0a0e1a] disabled:opacity-60"
        >
          {t('join', 'Join')}
        </button>
        <Link href="/launches" className="rounded-[8px] border border-white/15 px-[18px] py-[10px]">
          {t('cancel', 'Cancel')}
        </Link>
      </div>
    </div>
  );
};
