'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ProviderListSelect } from '@gitroom/frontend/components/new-launch/providers/provider.list.select';

export const SlackChannelSelect: FC<{
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
        label: t('slack_channels_label', 'Select channel'),
        loading: t('slack_channels_loading', 'Loading channels…'),
        failed: t('slack_channels_failed', 'Slack did not send your channels. Try again in a moment.'),
        none: t('slack_channels_none', 'No public channels found in this Slack workspace. Create one in Slack, then refresh.'),
        refresh: t('slack_channels_refresh', 'Refresh channels'),
      }}
    />
  );
};
