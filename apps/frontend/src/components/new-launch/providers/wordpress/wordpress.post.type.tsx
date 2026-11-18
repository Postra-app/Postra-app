'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ProviderListSelect } from '@gitroom/frontend/components/new-launch/providers/provider.list.select';

export const WordpressPostType: FC<{
  name: string;
  onChange: (event: { target: { value: string; name: string } }) => void;
}> = ({ name, onChange }) => {
  const t = useT();
  return (
    <ProviderListSelect
      name={name}
      fn="postTypes"
      onChange={onChange}
      texts={{
        label: t('wordpress_post_types_label', 'Select type'),
        loading: t('wordpress_post_types_loading', 'Loading post types…'),
        failed: t('wordpress_post_types_failed', 'WordPress did not send its post types. Try again in a moment.'),
        none: t('wordpress_post_types_none', 'No post types found on this WordPress site. Try again in a moment.'),
        refresh: t('wordpress_post_types_refresh', 'Refresh post types'),
      }}
    />
  );
};
