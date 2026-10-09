'use client';

import { FC } from 'react';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * Meta's requirement chain — professional account, a Page, full control of it,
 * every Page ticked in their dialog — is invisible until it fails, and it fails
 * late: the account picker comes back empty only after the user has been through
 * Meta's screens, by which point the OAuth step has already created a channel
 * carrying their own profile name. The first external tester read that as Postra
 * having rearranged her accounts. The tile tooltip carried the warning, but it is
 * hover-only and never rendered on mobile. Every fix lives in the Instagram app,
 * not here, so it has to be said before we send anyone out.
 *
 * Shared by the add-channel modal and the public invite page, which is the same
 * conversation held with someone who has never seen Postra.
 */
export const metaChecklists = {
  instagram: {
    title: {
      key: 'instagram_precheck_title',
      text: 'Before you connect Instagram',
    },
    intro: {
      key: 'instagram_precheck_intro',
      text: 'Meta only lets apps publish to an Instagram professional account that is linked to a Facebook Page. Setting that up takes about two minutes in the Instagram app, and you only do it once.',
    },
    steps: [
      {
        key: 'instagram_precheck_step_professional',
        text: 'In the Instagram app: Settings → Account type and tools → Switch to professional account → Business.',
      },
      {
        key: 'instagram_precheck_step_page',
        text: 'Still in Instagram: Edit profile → Page → choose the Facebook Page you publish as. No Page yet? You can create one in that same step.',
      },
      {
        key: 'instagram_precheck_step_tick',
        text: 'Then come back here and sign in with the Facebook account that manages that Page - and tick every Page in Meta’s dialog. A Page you skip stays invisible to us.',
      },
    ],
    note: {
      key: 'instagram_precheck_note',
      text: 'A personal Instagram account is invisible to every scheduling tool, not just Postra. The linking happens inside Instagram and Facebook - Postra never connects, moves or removes your accounts.',
    },
  },
  facebook: {
    title: {
      key: 'facebook_precheck_title',
      text: 'Before you connect Facebook',
    },
    intro: {
      key: 'facebook_precheck_intro',
      text: 'Facebook only lets apps publish to Pages. Publishing to a personal profile has not been possible for any app since 2018.',
    },
    steps: [
      {
        key: 'facebook_precheck_step_page',
        text: 'Have a Facebook Page for your business - creating one is free and takes about two minutes.',
      },
      {
        key: 'facebook_precheck_step_control',
        text: 'Make sure you have full control of it. On the New Pages experience that is Page access → Facebook access with full control.',
      },
      {
        key: 'facebook_precheck_step_tick',
        text: 'When you sign in, tick every Page in Meta’s dialog - a Page you skip there stays invisible to us.',
      },
    ],
    note: {
      key: 'facebook_precheck_note',
      text: 'Connecting only reads which Pages you manage. Postra never changes anything on your Facebook account.',
    },
  },
} as const;

export type MetaChecklistProvider = keyof typeof metaChecklists;

export const hasMetaChecklist = (
  identifier: string
): identifier is MetaChecklistProvider => identifier in metaChecklists;

export const MetaConnectChecklist: FC<{
  provider: MetaChecklistProvider;
  onConfirm: () => void;
  /**
   * Omitted on the invite page: someone who is not ready there has nowhere to
   * go back to, so the checklist stays on screen instead of offering an exit.
   */
  onCancel?: () => void;
}> = ({ provider, onConfirm, onCancel }) => {
  const t = useT();
  const checklist = metaChecklists[provider];
  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(checklist.intro.key, checklist.intro.text)}
      </p>
      <ol className="flex flex-col gap-[10px] list-decimal ps-[20px] text-[14px] text-textColor/80">
        {checklist.steps.map((step) => (
          <li key={step.key}>{t(step.key, step.text)}</li>
        ))}
      </ol>
      <p className="text-[12px] leading-[18px] text-customColor18">
        {t(checklist.note.key, checklist.note.text)}
      </p>
      <div className="flex gap-[10px] mt-[8px]">
        <Button type="button" className="flex-1" onClick={onConfirm}>
          {t('meta_precheck_continue', 'Done - continue')}
        </Button>
        {!!onCancel && (
          <Button
            type="button"
            className="flex-1 !bg-transparent border border-tableBorder text-textColor"
            onClick={onCancel}
          >
            {t('meta_precheck_open_help', 'Not yet - show me how')}
          </Button>
        )}
      </div>
    </div>
  );
};
