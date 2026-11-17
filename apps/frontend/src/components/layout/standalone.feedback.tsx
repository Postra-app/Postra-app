'use client';

import {
  DecisionEverywhere,
  ModalManagerEmitter,
  ModalManagerInner,
} from '@gitroom/frontend/components/layout/new-modal';
import { Toaster } from '@gitroom/react/toaster/toaster';

/**
 * Toasts and dialogs for the screens outside the app shell (sign-in, sign-up,
 * the return from a platform's consent screen, OAuth consent). The shell
 * mounts its own; these screens had none, so a failed sign-in during a deploy
 * showed nothing at all, and the "Payment required" dialog after connecting a
 * channel over the plan's limit was never drawn — the page spun for good.
 * Siblings, not a wrapper: the layouts keep their own boxes.
 */
export const StandaloneFeedback = () => (
  <>
    <ModalManagerEmitter />
    <ModalManagerInner />
    <DecisionEverywhere />
    <Toaster />
  </>
);
