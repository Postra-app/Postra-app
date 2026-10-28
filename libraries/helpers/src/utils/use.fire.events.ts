import { usePlausible } from 'next-plausible';
import { useCallback } from 'react';
import { useVariables } from '@gitroom/react/helpers/variable.context';

// Plausible only: PostHog went with upstream 3dc18da97. It sent the user's
// e-mail and name to a third party the moment a key was set, without consent,
// and Postra runs no such tracker.
export const useFireEvents = () => {
  const { billingEnabled } = useVariables();
  const plausible = usePlausible();

  return useCallback(
    (name: string, props?: any) => {
      if (!billingEnabled) {
        return;
      }

      plausible(name, { props });
    },
    [billingEnabled, plausible]
  );
};
