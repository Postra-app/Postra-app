'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
export const AfterActivate = () => {
  const fetch = useFetch();
  const params = useParams();
  const [showLoader, setShowLoader] = useState(true);
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState(false);
  const run = useRef(false);
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');

  useEffect(() => {
    if (!run.current) {
      run.current = true;
      loadCode();
    }
  }, []);
  const loadCode = useCallback(async () => {
    if (params.code) {
      try {
        const response = await fetch(`/auth/activate`, {
          method: 'POST',
          body: JSON.stringify({
            code: params.code,
            datafast_visitor_id,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        // A bad/expired code never resolves to `can` — don't mislead the
        // user into thinking the account is "already activated".
        if (!response.ok) {
          console.error('[Postra:auth] activate failed', response.status);
          setFailed(true);
          setShowLoader(false);
          return;
        }
        const { can, kept } = await response.json();
        if (kept) {
          setKept(true);
        }
        if (!can || kept) {
          setShowLoader(false);
        }
      } catch (e) {
        console.error('[Postra:auth] activate failed', e);
        setFailed(true);
        setShowLoader(false);
      }
    }
  }, []);
  return (
    <>
      {showLoader ? (
        <LoadingComponent />
      ) : (
        <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-[18px] text-textColor/78">
          {failed
            ? t(
                'activation_link_invalid',
                'This activation link is invalid or has expired.'
              )
            : kept
            ? t(
                'activated_still_signed_in',
                'The account is activated. You are still signed in to your current account; sign out to use the new one.'
              )
            : t('user_already_activated', 'This user is already activated')}
          <br />
          <Link href="/auth/login" className="underline underline-offset-4 hover:text-[#38bdf8]">
            {t(
              'click_here_to_go_back_to_login',
              'Click here to go back to login'
            )}
          </Link>
        </div>
      )}
    </>
  );
};
