import { useEffect } from 'react';

// The organisation lives in one cookie shared by every tab. Switching in one
// tab left the others showing organisation A while their requests went to B:
// a webhook created "in A" landed in B (E2E-08-35). A switch is announced to
// the other tabs, which reload into the organisation the cookie now holds.
const KEY = 'postra:org';

export const announceOrgChange = (orgId: string) => {
  try {
    localStorage.setItem(KEY, `${orgId}:${Date.now()}`);
  } catch {
    // Storage off (private window): the other tabs catch up on their next load.
  }
};

export const isOtherOrg = (value: string | null, currentOrgId?: string) =>
  !!value && !!currentOrgId && value.split(':')[0] !== currentOrgId;

export const useFollowOrgChange = (currentOrgId?: string) => {
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY && isOtherOrg(event.newValue, currentOrgId)) {
        window.location.reload();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [currentOrgId]);
};
