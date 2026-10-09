'use client';

import { withContinueProvider } from '../with-continue-provider';

interface InstagramItem {
  id: string;
  pageId: string;
  username: string;
  name: string;
  picture: {
    data: {
      url: string;
    };
  };
}

interface InstagramSelection {
  id: string;
  pageId: string;
}

export const InstagramContinue = withContinueProvider<
  InstagramItem,
  InstagramSelection
>({
  endpoint: 'pages',
  swrKey: 'load-instagram-pages',
  titleKey: 'select_instagram_account',
  titleDefault: 'Select Instagram Account:',
  note: {
    key: 'instagram_business_only_note',
    text: 'Only Business or Creator accounts linked to a Facebook Page appear here - Meta does not allow apps to publish to personal Instagram accounts.',
  },
  emptyStateMessages: [
    {
      key: 'instagram_empty_no_business_account',
      text: 'We could not find an Instagram account we are allowed to publish to.',
    },
    {
      key: 'instagram_empty_how_to_fix',
      text: 'Meta only allows publishing from an Instagram Business or Creator account that is linked to a Facebook Page. In the Instagram app open Settings → Account type and switch to Business or Creator, then link it to your Page (Edit profile → Page).',
    },
    {
      key: 'instagram_empty_tick_all_pages',
      text: 'Then connect Instagram again and tick every Page in the Facebook dialog - a Page you skip there stays invisible to us.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id, pageId: item.pageId }),
  transformSaveData: (selection) => selection,
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <>
      <div>
        <img
          className="w-full max-w-[156px]"
          src={item.picture.data.url}
          alt="profile"
        />
      </div>
      <div className="text-newTextColor">{item.name}</div>
      {!!item.username && item.username !== item.name && (
        <div className="text-[13px] text-newTextColor/70">@{item.username}</div>
      )}
    </>
  ),
});
