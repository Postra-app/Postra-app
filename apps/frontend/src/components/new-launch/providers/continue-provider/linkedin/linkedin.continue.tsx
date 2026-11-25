'use client';

import { FC, useState } from 'react';
import { withContinueProvider } from '../with-continue-provider';

interface LinkedinItem {
  id: string;
  pageId: string;
  username: string;
  name: string;
  picture?: string;
}

// LinkedIn returns no logo for a Page that has none, and a logo address can
// stop working; either way the picker shows the Page's initial instead of a
// broken image.
export const LinkedinPageItem: FC<{ name: string; picture?: string }> = ({
  name,
  picture,
}) => {
  const [failed, setFailed] = useState(false);
  return (
    <>
      <div>
        {picture && !failed ? (
          <img
            className="w-full"
            src={picture}
            alt=""
            onError={() => setFailed(true)}
          />
        ) : (
          <div
            aria-hidden="true"
            className="w-full aspect-square flex items-center justify-center rounded-[8px] bg-btnSimple text-[32px] font-[600]"
          >
            {name.trim().charAt(0).toLocaleUpperCase() || '?'}
          </div>
        )}
      </div>
      <div>{name}</div>
    </>
  );
};

interface LinkedinSelection {
  id: string;
  pageId: string;
}

export const LinkedinContinue = withContinueProvider<
  LinkedinItem,
  LinkedinSelection
>({
  endpoint: 'companies',
  swrKey: 'load-linkedin-pages',
  titleKey: 'select_linkedin_page',
  titleDefault: 'Select Linkedin Page:',
  emptyStateMessages: [
    {
      key: 'we_couldn_t_find_any_business_connected_to_your_linkedin_page',
      text: "We couldn't find any business connected to your LinkedIn Page.",
    },
    {
      key: 'please_close_this_dialog_create_a_new_page_and_add_a_new_channel_again',
      text: 'Please close this dialog, create a new page, and add a new channel again.',
    },
  ],
  getItemId: (item) => item.id,
  getSelectionValue: (item) => ({ id: item.id, pageId: item.pageId }),
  transformSaveData: (selection) => ({ page: selection.id }),
  isSelected: (item, selection) => selection?.id === item.id,
  renderItem: (item) => (
    <LinkedinPageItem name={item.name} picture={item.picture} />
  ),
});
