'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ProviderListSelect } from '@gitroom/frontend/components/new-launch/providers/provider.list.select';

export const DiscordChannelSelect: FC<{
  name: string;
  onChange: (event: { target: { value: string; name: string } }) => void;
}> = ({ name, onChange }) => {
  const t = useT();
  return (
    <ProviderListSelect
      name={name}
      fn="channels"
      onChange={onChange}
      texts={{
        label: t('discord_channels_label', 'Select channel'),
        loading: t('discord_channels_loading', 'Loading channels…'),
        failed: t('discord_channels_failed', 'Discord did not send your channels. Try again in a moment.'),
        none: t('discord_channels_none', 'No text channels found on this Discord server. Create one in Discord, then refresh.'),
        refresh: t('discord_channels_refresh', 'Refresh channels'),
      }}
    />
  );
};
