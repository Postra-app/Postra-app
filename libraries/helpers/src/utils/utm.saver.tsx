'use client';

import { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useTrack } from '@gitroom/react/helpers/use.track';

// Values earlier versions kept in the browser: the first page visited, its
// referrer and the campaign. Nothing reads them any more.
const LEGACY_KEYS = ['landingUrl', 'referrer', 'utm'];

const UtmSaver: FC = () => {
  const searchParams = useSearchParams();
  const fireEvents = useFireEvents();
  const track = useTrack();

  // Back from a checkout (?check=...): report the purchase once.
  useEffect(() => {
    if (searchParams.get('check')) {
      fireEvents('purchase');
      track(TrackEnum.StartTrial);
    }
  }, []);

  useEffect(() => {
    try {
      LEGACY_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Storage is blocked in this browser: there is nothing to remove.
    }
  }, []);

  return <></>;
};

export default UtmSaver;
