'use client';

import { FC, useCallback, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { OnboardingModal } from '@gitroom/frontend/components/onboarding/onboarding.modal';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

export const Onboarding: FC = () => {
  const query = useSearchParams();
  const modal = useModals();
  const router = useRouter();
  const modalOpen = useRef(false);
  const t = useT();
  // Someone who signed up through an invitation lands in the inviting
  // organisation as a member. "Connect your channels" is not theirs to do
  // there: every tile answered "you do not have permission".
  const member = useUser()?.role === 'USER';

  const handleClose = useCallback(() => {
    modal.closeAll();
    // replace: Back must not reopen the welcome window either.
    router.replace('/launches');
  }, [modal, router]);

  useEffect(() => {
    const onboarding = query.get('onboarding');
    if (!onboarding) {
      if (modalOpen.current) {
        modalOpen.current = false;
        modal.closeAll();
      }
      return;
    }
    if (modalOpen.current) {
      return;
    }
    if (member) {
      router.replace('/launches');
      return;
    }
    modalOpen.current = true;
    modal.openModal({
      // title: t('onboarding', 'Welcome to Postra'),
      withCloseButton: true,
      closeOnEscape: false,
      removeLayout: true,
      askClose: true,
      fullScreen: true,
      onClose: handleClose,
      children: <OnboardingModal onClose={handleClose} />,
    });
  }, [query, handleClose, t, member]);
  
  return null;
};
