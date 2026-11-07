'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const PinterestBoard: FC<{
  name: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
}> = (props) => {
  const { onChange, name } = props;
  const t = useT();

  const customFunc = useCustomProviderFunction();
  const [orgs, setOrgs] = useState<undefined | any[]>();
  const { getValues } = useSettings();
  const [currentMedia, setCurrentMedia] = useState<string | undefined>();
  const onChangeInner = (event: {
    target: {
      value: string;
      name: string;
    };
  }) => {
    setCurrentMedia(event.target.value);
    onChange(event);
  };
  // false: Pinterest refused the list (the route answers false when the
  // provider throws). A board made on pinterest.com while the composer is
  // open only shows up after asking again.
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customFunc.get('boards');
      setFailed(!Array.isArray(data));
      setOrgs(Array.isArray(data) ? data : []);
    } catch {
      setFailed(true);
      setOrgs([]);
    } finally {
      setLoading(false);
    }
  }, [customFunc]);
  useEffect(() => {
    load();
    const settings = getValues()[props.name];
    if (settings) {
      setCurrentMedia(settings);
    }
  }, []);
  if (!orgs) {
    return null;
  }
  const refresh = (
    <button
      type="button"
      onClick={load}
      disabled={loading}
      className="self-start text-[13px] underline text-textColor/80 hover:text-textColor disabled:opacity-50"
    >
      {loading
        ? t('pinterest_boards_loading', 'Loading boards…')
        : t('pinterest_boards_refresh', 'Refresh boards')}
    </button>
  );
  if (!orgs.length) {
    return (
      <div className="flex flex-col gap-[6px] text-[14px]">
        <div>
          {failed
            ? t(
                'pinterest_boards_failed',
                'Pinterest did not send your boards. Try again in a moment.'
              )
            : t(
                'pinterest_boards_none',
                'No boards found. Create a board on Pinterest, then refresh.'
              )}
        </div>
        {refresh}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[6px]">
      <Select
        name={name}
        label="Select board"
        onChange={onChangeInner}
        value={currentMedia}
      >
        <option value="">{t('select_1', '--Select--')}</option>
        {orgs.map((org: any) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </Select>
      {refresh}
    </div>
  );
};
