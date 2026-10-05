'use client';

import { useSearchParams } from 'next/navigation';
import { FC, useCallback, useEffect } from 'react';
import { sameOriginUrl } from '@gitroom/frontend/components/layout/safe.url';
const ReturnUrlComponent: FC = () => {
  const params = useSearchParams();
  const url = params.get('returnUrl');
  useEffect(() => {
    // Only a page of this app: "contains http" let `javascript:…//http`
    // and other sites through (E2E-08-30).
    const safe = sameOriginUrl(url, window.location.origin);
    if (safe) {
      localStorage.setItem('returnUrl', safe);
    }
  }, [url]);
  return null;
};
export const useReturnUrl = () => {
  return {
    getAndClear: useCallback(() => {
      const data = localStorage.getItem('returnUrl');
      localStorage.removeItem('returnUrl');
      return data;
    }, []),
  };
};
export default ReturnUrlComponent;
