'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import { useClickOutside } from '@mantine/hooks';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { DropdownArrowIcon } from '@gitroom/frontend/components/ui/icons';

// Show only some channels' posts in the calendar and the list (upstream
// 9bf96ebc). Listed channels follow the selected agency client. The list is
// a portal for the same reason as SelectCustomer's: the calendar header's
// backdrop-filter re-anchors position:fixed and clips it.
export const SelectChannels: FC = () => {
  const { integrations, customer, selectedChannels, setSelectedChannels } =
    useCalendar();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  useClickOutside(
    () => {
      if (open) {
        setOpen(false);
      }
    },
    null,
    [trigger, list]
  );

  const channels = useMemo(
    () =>
      integrations.filter((i) => !customer || i.customer?.id === customer),
    [integrations, customer]
  );
  const selectedIds = selectedChannels ?? channels.map((c) => c.id);
  const allSelected = channels.every((c) => selectedIds.includes(c.id));

  const openClose = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    const box = trigger?.getBoundingClientRect();
    if (box) {
      const width = 270;
      setPos({
        top: box.bottom + 8,
        left: Math.max(
          8,
          Math.min(box.right - width, window.innerWidth - width - 8)
        ),
      });
    }
    setOpen(true);
  }, [open, trigger]);

  const toggleAll = useCallback(() => {
    setSelectedChannels(allSelected ? [] : null);
  }, [allSelected, setSelectedChannels]);

  const toggle = useCallback(
    (id: string) => () => {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id];
      setSelectedChannels(next.length === channels.length ? null : next);
    },
    [selectedIds, channels, setSelectedChannels]
  );

  if (channels.length <= 1) {
    return null;
  }

  const label = t('select_channels_tooltip', 'Show channels');
  return (
    <div className="relative select-none z-[500]">
      <button
        type="button"
        ref={setTrigger}
        aria-label={label}
        aria-expanded={open}
        data-tooltip-id="tooltip"
        data-tooltip-content={label}
        onClick={openClose}
        className={clsx(
          'launches-control-surface relative z-[20] cursor-pointer h-[42px] rounded-[12px] pl-[14px] pr-[12px] gap-[8px] border flex items-center bg-[rgba(15,23,42,0.74)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors',
          open || !allSelected
            ? 'border-sky-400/50 bg-white/[0.06]'
            : 'border-white/10 hover:border-white/20'
        )}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
        {!allSelected && (
          <span className="text-[13px] font-[600] text-sky-300">
            {selectedIds.length}/{channels.length}
          </span>
        )}
        <DropdownArrowIcon rotated={open} />
      </button>
      {open &&
        createPortal(
          <div
            ref={setList}
            style={pos}
            className="launches-dropdown-surface text-textColor flex flex-col fixed z-[600] py-[8px] bg-[rgba(15,23,42,0.96)] backdrop-blur-xl shadow-[0_24px_80px_rgba(2,6,23,0.45)] min-w-[270px] max-h-[340px] overflow-y-auto rounded-[16px] border border-white/10"
          >
            <div className="px-[12px] py-[10px] text-[14px] font-[600] flex items-center border-b border-white/10">
              <Checkbox
                disableForm={true}
                checked={allSelected}
                onChange={toggleAll}
                label={t('select_all', 'Select all')}
              />
            </div>
            {channels.map((p) => (
              <div
                key={p.id}
                className="px-[12px] py-[8px] hover:bg-white/[0.06] text-[14px] font-[500] flex items-center gap-[10px] transition-colors"
              >
                <Checkbox
                  disableForm={true}
                  checked={selectedIds.includes(p.id)}
                  onChange={toggle(p.id)}
                  ariaLabel={p.name}
                />
                <img
                  className="w-[24px] h-[24px] rounded-full"
                  src={p.picture || '/no-picture.jpg'}
                  alt=""
                />
                <div className="truncate">{p.name}</div>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};
