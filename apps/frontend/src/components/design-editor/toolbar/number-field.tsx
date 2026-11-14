'use client';

import { FC, useEffect, useRef, useState } from 'react';

interface NumberFieldProps {
  value: number;
  /** Applied on every keystroke that is a whole number inside min..max, and
   *  once more, clamped, when the field is left or Enter is pressed. */
  onChange: (value: number) => void;
  /** After the final value: the design records one undo step. */
  onCommit?: () => void;
  min?: number;
  max?: number;
  className?: string;
  'aria-label': string;
}

/**
 * A number the user types into while the design follows. The field keeps
 * what is being typed: when it showed the object's value instead, every
 * keystroke was clamped and the next digit landed after the clamped one, so
 * "1320" typed as a width became 4320 (the first "1" raised to the minimum 4)
 * and a negative position could not be typed at all.
 */
export const NumberField: FC<NumberFieldProps> = ({
  value,
  onChange,
  onCommit,
  min = -Infinity,
  max = Infinity,
  className,
  'aria-label': ariaLabel,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  // Escape puts back the value the field had when it was entered (the
  // design already follows the keystrokes); set before blur, which runs
  // before a state update would.
  const discard = useRef(false);
  const start = useRef(value);

  // A new object or an undo changes the value under a field nobody edits.
  useEffect(() => {
    setDraft(null);
  }, [value]);

  const parse = (raw: string) => {
    const v = parseInt(raw, 10);
    return Number.isNaN(v) ? null : v;
  };

  const finish = () => {
    if (discard.current) {
      if (value !== start.current) onChange(start.current);
    } else if (draft !== null) {
      const v = parse(draft);
      if (v !== null) onChange(Math.min(max, Math.max(min, v)));
    }
    discard.current = false;
    setDraft(null);
    onCommit?.();
  };

  return (
    <input
      type="number"
      min={Number.isFinite(min) ? min : undefined}
      max={Number.isFinite(max) ? max : undefined}
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const v = parse(raw);
        if (v !== null && v >= min && v <= max) onChange(v);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          discard.current = true;
          e.currentTarget.blur();
        }
      }}
      onFocus={() => {
        start.current = value;
      }}
      onBlur={finish}
      className={className}
      aria-label={ariaLabel}
    />
  );
};
