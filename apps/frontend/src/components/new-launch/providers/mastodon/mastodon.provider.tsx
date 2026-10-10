'use client';

import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { MastodonDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/mastodon.dto';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Every Mastodon post went out public (K32, 2026-10-10); public stays the
// default.
const MastodonSettings = () => {
  const t = useT();
  const { register } = useSettings();
  return (
    <Select
      label={t('label_who_can_see_this_post', 'Who can see this post?')}
      {...register('visibility', { value: 'public' })}
    >
      <option value="public">{t('mastodon_visibility_public', 'Public')}</option>
      <option value="unlisted">{t('mastodon_visibility_unlisted', 'Unlisted (not in public timelines)')}</option>
      <option value="private">{t('mastodon_visibility_private', 'Followers only')}</option>
    </Select>
  );
};

export default withProvider<MastodonDto>({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: MastodonSettings,
  CustomPreviewComponent: undefined,
  dto: MastodonDto,
  maximumCharacters: 500,
});
