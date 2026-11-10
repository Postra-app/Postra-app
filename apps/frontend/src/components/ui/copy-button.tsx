'use client';

import { useCallback, useState } from 'react';
import copy from 'copy-to-clipboard';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';

export const CopyButton = ({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) => {
  const toaster = useToaster();
  const t = useT();
  const [copied, setCopied] = useState(false);

  const onClick = useCallback(() => {
    copy(text);
    setCopied(true);
    toaster.show(t('copied_to_clipboard', 'Copied to clipboard'), 'success');
    setTimeout(() => setCopied(false), 1500);
  }, [text, t, toaster]);

  // Named by its visible label ("Copy ID", "Copy URL"): a shared "Copy to
  // clipboard" hid which button was which from a screen reader, and voice
  // control could not reach "Copy" by the word on it.
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'cursor-pointer px-[16px] h-[36px] bg-btnSimple hover:bg-boxHover transition-colors rounded-[8px] text-[13px] font-[600] flex items-center gap-[6px]',
        className
      )}
    >
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-[#38bdf8]"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      )}
      {label}
    </button>
  );
};
