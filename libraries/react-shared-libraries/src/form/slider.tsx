'use client';

import { FC, useCallback } from 'react';
import clsx from 'clsx';

// An on/off switch. It was a div with onClick: no role, no name, never
// reached by Tab, so a keyboard or screen reader user could not turn email
// notifications, Auto Post feeds or plugs on or off (E2E-05-73).
export const Slider: FC<{
  value: 'on' | 'off';
  fill?: boolean;
  /** What the switch turns on, read out by screen readers. */
  label: string;
  onChange: (value: 'on' | 'off') => void;
}> = (props) => {
  const { value, onChange, fill, label } = props;
  const change = useCallback(() => {
    onChange(value === 'on' ? 'off' : 'on');
  }, [value]);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value === 'on'}
      aria-label={label}
      className={clsx(
        'block w-[57px] h-[34px] p-[4px] border-fifth border rounded-[100px] cursor-pointer',
        value === 'on' && fill && 'bg-customColor4'
      )}
      onClick={change}
    >
      <span className="block w-full h-full relative rounded-[100px]">
        <span
          className={clsx(
            'block absolute left-0 top-0 w-[24px] h-[24px] bg-customColor5 rounded-full transition-all',
            value === 'on' ? 'left-[100%] -translate-x-[100%]' : 'left-0'
          )}
        />
      </span>
    </button>
  );
};
