'use client';

import { FC, ReactNode, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';

const SWR_OPTIONS = {
  refreshWhenHidden: false,
  refreshWhenOffline: false,
  revalidateOnFocus: false,
  revalidateIfStale: false,
  revalidateOnMount: true,
  revalidateOnReconnect: false,
  refreshInterval: 0,
};

export interface ContinueProviderProps {
  onSave: (data: any) => Promise<void>;
  initialData?: any[];
  isSaving?: boolean;
  /**
   * Removes the half-finished channel the OAuth step already created. Passed
   * only where we own that row and the user is logged in; without it the empty
   * state just explains the problem.
   */
  onDiscard?: () => Promise<void>;
}

export interface EmptyStateMessage {
  key: string;
  text: string;
}

export interface ContinueProviderConfig<TItem, TSelection> {
  endpoint: string;
  swrKey: string;
  titleKey: string;
  titleDefault: string;
  /**
   * One line under the title, for providers where the list is narrower than the
   * user expects — Meta hands us Pages and Business/Creator accounts only, so
   * someone connecting a one-person business sees a single entry and assumes it
   * failed. The help tab explains it, but nobody opens the help tab in the
   * middle of an OAuth flow.
   */
  note?: EmptyStateMessage;
  emptyStateMessages: EmptyStateMessage[];
  getSelectionValue: (item: TItem) => TSelection;
  transformSaveData: (selection: TSelection) => any;
  renderItem: (item: TItem, isSelected: boolean) => ReactNode;
  isSelected: (item: TItem, selection: TSelection | null) => boolean;
  getItemId: (item: TItem) => string;
}

export function withContinueProvider<TItem, TSelection>(
  config: ContinueProviderConfig<TItem, TSelection>
): FC<ContinueProviderProps> {
  const {
    endpoint,
    swrKey,
    titleKey,
    titleDefault,
    note,
    emptyStateMessages,
    getSelectionValue,
    transformSaveData,
    renderItem,
    isSelected,
    getItemId,
  } = config;

  return function ContinueProviderComponent(props: ContinueProviderProps) {
    const { onSave, initialData, isSaving, onDiscard } = props;
    const call = useCustomProviderFunction();
    const t = useT();
    const [selection, setSelection] = useState<TSelection | null>(null);
    const [isDiscarding, setIsDiscarding] = useState(false);

    const loadData = useCallback(async () => {
      // Skip fetch if initial data was provided
      if (initialData) {
        return initialData;
      }
      try {
        return await call.get(endpoint);
      } catch (e) {
        // Handle error silently
      }
    }, [initialData]);

    const { data, isLoading } = useSWR(
      initialData ? null : swrKey,
      loadData,
      SWR_OPTIONS
    );

    const resolvedData = initialData || data;

    const handleSelect = useCallback(
      (item: TItem) => () => {
        setSelection(getSelectionValue(item));
      },
      []
    );

    const handleSave = useCallback(async () => {
      if (selection) {
        await onSave(transformSaveData(selection));
      }
    }, [onSave, selection]);

    const items = useMemo(
      () => (resolvedData as TItem[]) || [],
      [resolvedData]
    );

    if (!isLoading && !resolvedData?.length) {
      return (
        <div className="flex flex-col justify-center items-center gap-[16px] text-center text-[15px] leading-[24px] min-h-[300px] py-[20px]">
          {emptyStateMessages.map((msg) => (
            <span key={msg.key}>{t(msg.key, msg.text)}</span>
          ))}
          {/* The OAuth step already created a channel row. Nothing here can
              complete it, so offer the cleanup instead of telling the user to
              go and find the half-connected channel themselves — that entry
              shows up in their sidebar with an error badge and their own
              profile name on it. */}
          {!!onDiscard && (
            <Button
              className="mt-[4px]"
              loading={isDiscarding}
              disabled={isDiscarding}
              onClick={async () => {
                setIsDiscarding(true);
                try {
                  await onDiscard();
                } finally {
                  setIsDiscarding(false);
                }
              }}
            >
              {t('remove_unfinished_channel', 'Remove the unfinished channel')}
            </Button>
          )}
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-[20px]">
        <div className="flex flex-col gap-[6px]">
          <div>{t(titleKey, titleDefault)}</div>
          {!!note && (
            <div className="text-[12px] leading-[18px] text-customColor18">
              {t(note.key, note.text)}
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 justify-items-center select-none cursor-pointer gap-[10px]">
          {items.map((item) => (
            <div
              key={getItemId(item)}
              className={clsx(
                'flex flex-col w-full text-center gap-[10px] border border-input p-[10px] hover:bg-seventh rounded-[8px]',
                isSelected(item, selection) && 'bg-seventh border-primary'
              )}
              onClick={handleSelect(item)}
            >
              {renderItem(item, isSelected(item, selection))}
            </div>
          ))}
        </div>
        <div>
          <Button disabled={!selection || isSaving} loading={isSaving} onClick={handleSave}>
            {t('save', 'Save')}
          </Button>
        </div>
      </div>
    );
  };
}
