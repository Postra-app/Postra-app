'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export type ProviderListTexts = {
  label: string;
  loading: string;
  failed: string;
  none: string;
  refresh: string;
};

/**
 * A setting picked from a list the platform sends (a Slack or Discord
 * channel, a WordPress post type). The list can be slow, empty or refused
 * (the route answers false when the provider throws): each case says so and
 * offers to ask again, instead of an empty panel and a save that fails with
 * "channel should not be null or undefined".
 */
export const ProviderListSelect: FC<{
  name: string;
  fn: string;
  texts: ProviderListTexts;
  onChange: (event: { target: { value: string; name: string } }) => void;
}> = ({ name, fn, texts, onChange }) => {
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const { getValues } = useSettings();
  const [items, setItems] = useState<undefined | { id: string; name: string }[]>();
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [current, setCurrent] = useState<string | undefined>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await customFunc.get(fn);
      setFailed(!Array.isArray(data));
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setFailed(true);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [customFunc, fn]);

  useEffect(() => {
    load();
    const saved = getValues()[name];
    if (saved) {
      setCurrent(saved);
    }
  }, []);

  const onChangeInner = (event: { target: { value: string; name: string } }) => {
    setCurrent(event.target.value);
    onChange(event);
  };

  const refresh = (
    <button
      type="button"
      onClick={load}
      disabled={loading}
      className="self-start text-[13px] underline text-textColor/80 hover:text-textColor disabled:opacity-50"
    >
      {loading ? texts.loading : texts.refresh}
    </button>
  );

  if (!items) {
    return (
      <div className="text-[14px] text-textColor/80" role="status">
        {texts.loading}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="flex flex-col gap-[6px] text-[14px]" role="status">
        <div>{failed ? texts.failed : texts.none}</div>
        {refresh}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <Select name={name} label={texts.label} onChange={onChangeInner} value={current}>
        <option value="">{t('select_1', '--Select--')}</option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </Select>
      {refresh}
    </div>
  );
};
