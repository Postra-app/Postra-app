'use client';

import React, { useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import { Card } from '@gitroom/frontend/components/ui/card';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { showMediaBox } from '@gitroom/frontend/components/media/media.component';

type Picture = { id: string; path: string } | null;

// Name, bio and picture: what a team sees on comments and in Teams. The API
// was here all along, but the form had no fields since an upstream rework, so
// nobody could change their name or picture on the web (K21, 2026-10-10).
const ProfileComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useSWR('user-personal', async () =>
    (await fetch('/user/personal')).json()
  );

  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [picture, setPicture] = useState<Picture>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.name || '');
    setBio(data.bio || '');
    setPicture(data.picture?.id ? { id: data.picture.id, path: data.picture.path } : null);
  }, [data]);

  const choosePicture = useCallback(() => {
    showMediaBox((media) => setPicture({ id: media.id, path: media.path }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch('/user/personal', {
        method: 'POST',
        body: JSON.stringify({ fullname: name.trim(), bio, picture }),
      });
      if (!res.ok) {
        toaster.show(
          (await readResponseError(res)) ||
            t('profile_not_saved', 'Could not save your profile.'),
          'warning'
        );
        return;
      }
      await mutate();
      toaster.show(t('profile_updated', 'Profile updated'), 'success');
    } finally {
      setSaving(false);
    }
  }, [name, bio, picture, fetch, toaster, t, mutate]);

  const input =
    'h-[38px] px-[12px] rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-newTextColor text-[13.5px] outline-none focus:border-[#38bdf8]';

  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[16px]">
      <div className="flex flex-col gap-[4px]">
        <div className="text-[15px] font-[600] text-newTextColor">{t('profile', 'Profile')}</div>
        <div className="text-[13px] text-newTextColor/70 max-w-[560px]">
          {t('profile_description', 'Your name and picture, as your team sees them on comments and in Teams.')}
        </div>
      </div>
      <div className="flex items-center gap-[12px]">
        <div className="w-[48px] h-[48px] rounded-full bg-white/[0.08] overflow-hidden shrink-0">
          {!!picture?.path && (
            <img src={picture.path} alt={t('profile_picture', 'Profile Picture')} className="w-full h-full object-cover" />
          )}
        </div>
        <Button variant="secondary" type="button" onClick={choosePicture}>
          {t('choose_picture', 'Choose picture')}
        </Button>
        {!!picture && (
          <Button variant="ghost" type="button" onClick={() => setPicture(null)}>
            {t('remove', 'Remove')}
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-[6px] max-w-[420px]">
        <label className="text-[12px] text-newTextColor/55" htmlFor="profile-name">
          {t('label_full_name', 'Full Name')}
        </label>
        <input id="profile-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={input} />
      </div>
      <div className="flex flex-col gap-[6px] max-w-[560px]">
        <label className="text-[12px] text-newTextColor/55" htmlFor="profile-bio">
          {t('bio', 'Bio')}
        </label>
        <textarea
          id="profile-bio"
          rows={3}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className={input.replace('h-[38px]', 'py-[8px]')}
        />
      </div>
      <div>
        <Button type="button" loading={saving} disabled={name.trim().length < 3} onClick={save}>
          {t('save', 'Save')}
        </Button>
      </div>
    </Card>
  );
};

export default ProfileComponent;
