import React, { FC, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Button } from '@gitroom/frontend/components/ui/button';

export const PreConditionComponentModal: FC = () => {
  const modal = useModals();
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="whitespace-pre-line">
        This social channel was previously connected to another Postra
        account, so it cannot be added during a free trial.{'\n'}
        {'\n'}
        To add it, end your trial now. You will see the price and confirm the
        payment on the next screen.
      </div>
      <div className="flex gap-[2px] justify-center">
        {/* Goes to the confirmation; nothing is charged by this button
            (E2E-07-41). */}
        <Button
          onClick={() => (window.location.href = '/billing?finishTrial=true')}
        >
          End my trial
        </Button>
        <Button onClick={modal.closeCurrent} secondary={true}>Cancel</Button>
      </div>
    </div>
  );
};
export const PreConditionComponent: FC = () => {
  const modal = useModals();
  const query = useSearchParams();
  useEffect(() => {
    if (query.get('precondition')) {
      modal.openModal({
        title: 'This channel was used in another Postra account',
        withCloseButton: true,
        classNames: {
          modal: 'text-textColor',
        },
        children: <PreConditionComponentModal />,
      });
    }
  }, []);
  return null;
};
