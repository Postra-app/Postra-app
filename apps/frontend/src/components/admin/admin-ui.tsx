'use client';

import { ButtonHTMLAttributes, DetailedHTMLProps, FC } from 'react';
import { clsx } from 'clsx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const variantClass: Record<Variant, string> = {
  // B — solid cyan (chosen)
  primary: 'bg-[#38bdf8] text-[#06222e] hover:brightness-110',
  secondary:
    'bg-white/[0.06] border border-white/[0.12] text-newTextColor hover:bg-white/[0.10]',
  ghost:
    'bg-transparent border border-white/[0.12] text-newTextColor/60 hover:text-newTextColor hover:bg-white/[0.05]',
  danger:
    'bg-[rgba(248,113,113,0.14)] border border-[rgba(248,113,113,0.4)] text-[#fca5a5] hover:bg-[rgba(248,113,113,0.22)]',
};

/**
 * Admin-scoped button. Drop-in replacement for the shared <Button> (same props:
 * `secondary`, `loading`, `disabled`, onClick…) so files can `import { AdminButton as Button }`
 * and keep their JSX. Styled to the Postra dark-glass system (solid-cyan primary).
 * NOT used outside /admin — the shared @gitroom/react/form/button stays untouched.
 */
export const AdminButton: FC<
  DetailedHTMLProps<
    ButtonHTMLAttributes<HTMLButtonElement>,
    HTMLButtonElement
  > & {
    variant?: Variant;
    secondary?: boolean;
    loading?: boolean;
  }
> = ({ children, variant, secondary, loading, className, ...props }) => {
  const v: Variant = variant ?? (secondary ? 'secondary' : 'primary');
  // `loading` used to set only opacity and pointer-events, which stops a mouse
  // and not a keyboard: Enter on a focused button fired onClick again. The
  // announcement form uses exactly this pattern, and an announcement is shown
  // to every user of the product (E2E-09-54).
  const busy = !!loading;
  return (
    <button
      {...props}
      type={props.type || 'button'}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-[7px] rounded-[10px] px-[18px] h-[38px] text-[13.5px] font-[600] cursor-pointer transition-all duration-150 whitespace-nowrap',
        variantClass[v],
        // /60 rather than /40: the disabled label measured 2.23:1 against the
        // panel background, well under the 4.5:1 floor (E2E-09-55).
        (props.disabled || busy) && 'opacity-60 pointer-events-none',
        className
      )}
    >
      {children}
    </button>
  );
};

/**
 * The reason the server gave, so the operator can act on it.
 *
 * Every failure path in the panel showed its own generic line and dropped the
 * response body. Measured on production: comping an organization that has a
 * live Stripe customer answers 400 "This organization has a live Stripe
 * customer — change the plan in Stripe instead", and the operator saw only
 * "Failed to add the subscription" — the actionable half never arrived.
 *
 * Nest sends `message` as a string, or as an array when class-validator
 * rejects a DTO. Both collapse to one line here.
 */
export const serverReason = async (res: Response): Promise<string | null> => {
  try {
    const body = await res.clone().json();
    const message = body?.message;
    if (typeof message === 'string' && message.trim()) {
      return message.trim();
    }
    if (Array.isArray(message) && message.length) {
      return message.filter((m) => typeof m === 'string').join('; ') || null;
    }
    return null;
  } catch {
    return null;
  }
};

/** Generic line, plus the server's reason when it gave one. */
export const withReason = async (res: Response, generic: string) => {
  const reason = await serverReason(res);
  return reason ? `${generic}: ${reason}` : generic;
};

/**
 * What actually happened to a delete, as three named outcomes.
 *
 * A pure function rather than three branches inside the handler, because the
 * interesting one is easy to get wrong and impossible to reach by clicking:
 * removing a row that is already gone answers 200 with `{deleted:false}` —
 * the repository stopped throwing so the endpoint would stop answering 500
 * (E2E-09-46) — and a handler that checks only `res.ok` reports that as a
 * success for a delete that removed nothing (E2E-09-14). The FREE badge
 * taught the same lesson the hard way: a branch nobody can reach is a branch
 * nobody tested.
 */
export const deleteOutcome = (
  ok: boolean,
  body: unknown
): 'failed' | 'already-gone' | 'deleted' => {
  if (!ok) {
    return 'failed';
  }
  if (
    body &&
    typeof body === 'object' &&
    (body as { deleted?: unknown }).deleted === false
  ) {
    return 'already-gone';
  }
  return 'deleted';
};

/**
 * Tier pill — one definition for the whole panel.
 *
 * Organizations and Subscriptions each kept their own map for the same tiers,
 * and the Subscriptions one put white text on a pastel fill. Measured on
 * production against its own background: 2.64:1, where 11px text needs 4.5:1
 * (E2E-09-55 again — the first pass fixed the /30 opacities and never looked
 * at this pill). The accessible pairing is a tinted fill with saturated text,
 * which is what Organizations already used, so that is the one that stays.
 *
 * An organization with no subscription row IS on FREE, so the label and the
 * colour come from the same call — reading the tier directly let the
 * missing-tier branch fire first and paint every free account with the error
 * colour (E2E-09-29).
 */
export const tierLabel = (tier?: string | null) => tier || 'FREE';

const tierBadgeColors: Record<string, string> = {
  ULTIMATE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  PRO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TEAM: 'bg-green-500/20 text-green-400 border-green-500/30',
  STANDARD: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  FREE: 'bg-white/10 text-newTextColor/70 border-white/15',
};

// Red stays for a tier this map genuinely does not know, which is a real
// signal that something is wrong, rather than for the commonest tier there is.
const unknownTierBadgeColor = 'bg-red-500/20 text-red-400 border-red-500/30';

export const tierBadgeClass = (tier?: string | null) =>
  clsx(
    'inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-[500] border',
    tierBadgeColors[tierLabel(tier)] ?? unknownTierBadgeColor
  );

/** Shared control styles — rounded glass, accent focus. */
export const adminInput =
  'bg-white/[0.04] h-[38px] border border-white/[0.12] rounded-[10px] px-[12px] text-[14px] text-newTextColor placeholder:text-newTextColor/70 outline-none focus:border-[rgba(56,189,248,0.5)] transition-colors';

export const adminSelect = `${adminInput} cursor-pointer`;

/**
 * Segmented filter pill (Today / 7d / 30d …). Active = cyan tint, NOT solid
 * cyan — solid cyan is reserved for the primary action CTA so the two don't
 * compete. Use for toggle groups, not for buttons that perform an action.
 */
export const adminSegment = (active: boolean) =>
  clsx(
    'h-[32px] px-[14px] rounded-[10px] text-[13px] border cursor-pointer whitespace-nowrap transition-colors',
    active
      ? 'bg-[rgba(56,189,248,0.16)] border-[rgba(56,189,248,0.5)] text-[#7dd3fc] font-[600]'
      : 'bg-white/[0.03] text-newTextColor/70 border-white/10 hover:border-white/25 hover:text-newTextColor'
  );

/**
 * Props every segmented pill should spread, so a screen reader is told which
 * one is chosen. None of the call sites set aria-pressed (E2E-09-13).
 */
export const adminSegmentProps = (active: boolean) => ({
  className: adminSegment(active),
  'aria-pressed': active,
});

/**
 * The admin panel is English only, by decision rather than by accident.
 *
 * It used to borrow the product's generic translation keys — `name`,
 * `channels`, `posts`, `next`, `loading`, `from`, `to` — which do have Polish
 * entries, while the admin-specific keys have entries in no locale at all. On
 * PL the Organizations header therefore read "Nazwa | Tier | Period | Kanaly |
 * Users | Posty | Created" and the pager "Prev / Dalej" (E2E-09-12).
 *
 * Rule: every t() key inside /admin is admin-specific, and no locale file
 * carries an entry for one — the seventeen that had been translated were
 * removed. The English fallback at the call site always renders, and the panel
 * can still be translated later as a deliberate act rather than by leaking in
 * through borrowed keys.
 */

/**
 * Channel state pill — one definition, beside the tier pill, for the same
 * reason (E2E-09-55).
 *
 * The colours carry the verdict, so they are chosen against what the operator
 * should do rather than against how alarming the word sounds. `expiring` is
 * deliberately informational blue and not amber: for YouTube and TikTok it is
 * the resting state, and painting it as a warning would rebuild the misreading
 * this whole tab exists to prevent (E2E-09-59).
 *
 * Saturated text on a tinted fill, which is the pairing that measured clean
 * the last time this was audited.
 */
const channelStateBadgeColors: Record<string, string> = {
  'needs-reconnect': 'bg-red-500/20 text-red-400 border-red-500/40',
  'setup-incomplete': 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  disabled: 'bg-white/10 text-newTextColor/70 border-white/15',
  expired: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  expiring: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  ok: 'bg-green-500/20 text-green-400 border-green-500/30',
  deleted: 'bg-white/[0.06] text-newTextColor/60 border-white/10',
};

export const channelStateBadgeClass = (state: string) =>
  clsx(
    'inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-[500] border whitespace-nowrap',
    channelStateBadgeColors[state] ??
      'bg-red-500/20 text-red-400 border-red-500/30'
  );

/**
 * How long a token has left, in words.
 *
 * `null` is a provider that never reports an expiry — four of them do not
 * (E2E-09-59) — and it has to say so outright. An empty cell is read as a
 * fault, which is the opposite of the truth here.
 */
export const formatExpiry = (seconds: number | null | undefined): string => {
  if (seconds === null || seconds === undefined) {
    return 'Does not expire';
  }
  const abs = Math.abs(seconds);
  const unit =
    abs < 3600
      ? `${Math.max(1, Math.round(abs / 60))}m`
      : abs < 48 * 3600
      ? `${Math.round(abs / 3600)}h`
      : `${Math.round(abs / 86400)}d`;

  return seconds < 0 ? `Expired ${unit} ago` : `in ${unit}`;
};
