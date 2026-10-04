'use client';

import { ButtonHTMLAttributes, DetailedHTMLProps, FC } from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variantClass: Record<Variant, string> = {
  // solid cyan — primary CTA (admin design language)
  primary: 'bg-[#38bdf8] text-[#06222e] hover:brightness-110',
  secondary:
    'bg-white/[0.06] border border-white/[0.12] text-newTextColor hover:bg-white/[0.10]',
  ghost:
    'bg-transparent border border-white/[0.12] text-newTextColor/60 hover:text-newTextColor hover:bg-white/[0.05]',
  danger:
    'bg-[rgba(248,113,113,0.14)] border border-[rgba(248,113,113,0.4)] text-[#fca5a5] hover:bg-[rgba(248,113,113,0.22)]',
};

/** The button look, for a link that navigates (works before hydration). */
export const buttonClass = (
  variant: Variant = 'primary',
  size: 'sm' | 'md' = 'md'
) =>
  clsx(
    'inline-flex items-center justify-center gap-[7px] rounded-[10px] font-[600] cursor-pointer transition-all duration-150 whitespace-nowrap',
    size === 'sm'
      ? 'h-[30px] px-[12px] text-[12px]'
      : 'h-[38px] px-[18px] text-[13.5px]',
    variantClass[variant]
  );

/**
 * Postra button — admin design language (solid-cyan primary). Drop-in for the
 * shared @gitroom/react/form/button (same props: secondary, loading, disabled,
 * onClick…), so screens can swap the import and keep their JSX. App-wide,
 * neutral version of AdminButton (admin-ui.tsx). Dims on loading like admin
 * (no spinner) — keep that consistent with the panel.
 */
export const Button: FC<
  DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > & {
    variant?: Variant;
    secondary?: boolean;
    loading?: boolean;
    size?: 'sm' | 'md';
  }
> = ({ children, variant, secondary, loading, size, className, ...props }) => {
  const v: Variant = variant ?? (secondary ? 'secondary' : 'primary');
  return (
    <button
      {...props}
      type={props.type || 'button'}
      className={clsx(
        buttonClass(v, size),
        (props.disabled || loading) && 'opacity-40 pointer-events-none',
        className
      )}
    >
      {children}
    </button>
  );
};
