'use client';

import { withContinueProvider } from '../with-continue-provider';

interface FacebookItem {
  id: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

export const FacebookContinue = withContinueProvider<FacebookItem, string>({
  endpoint: 'pages',
  swrKey: 'load-facebook-pages',
  titleKey: 'select_page',
  titleDefault: 'Select Page:',
  note: {
    key: 'facebook_pages_only_note',
    text: 'Only Facebook Pages appear here - Meta does not allow apps to publish to personal profiles, so seeing just your Page is normal.',
  },
  emptyStateMessages: [
    {
      key: 'facebook_empty_no_pages',
      text: 'We could not find a Facebook Page on your account.',
    },
    {
      key: 'facebook_empty_pages_only',
      text: 'Postra publishes to Pages, never to personal profiles - Meta removed API publishing to personal timelines in 2018. If you do not have a Page yet, create one (it is free and takes about two minutes) or ask its owner for full control of theirs.',
    },
    {
      key: 'facebook_empty_tick_all_pages',
      text: 'If you do have a Page, connect Facebook again and tick every Page in the Facebook dialog - a Page you skip there stays invisible to us.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => item.id,
  transformSaveData: (selection) => ({ page: selection }),
  isSelected: (item, selection) => selection === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img className="w-full" src={item.picture.data.url} alt="profile" />
      </div>
      <div>{item.name}</div>
    </>
  ),
});
