'use client';

import { Button } from '@gitroom/frontend/components/ui/button';
import { useCallback } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const ClosePreviewButton = () => {
  const t = useT();
  const close = useCallback(() => {
    window.close();
  }, []);
  return (
    <Button onClick={close} className="bg-btnSimple text-btnText">
      {t('close', 'Close')}
    </Button>
  );
};
