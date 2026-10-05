import { useIntegration } from '@gitroom/frontend/components/launches/helpers/use.integration';
import { useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
export const useCustomProviderFunction = () => {
  const { integration } = useIntegration();
  const fetch = useFetch();
  const get = useCallback(
    async (funcName: string, customData?: any) => {
      const load = await fetch('/integrations/function', {
        method: 'POST',
        body: JSON.stringify({
          name: funcName,
          id: integration?.id!,
          data: customData,
        }),
      });
      // Never true as `> 299 && < 200`: an error body went on as data and
      // pickers crashed on it (E2E-05-47).
      if (!load.ok) {
        throw new Error('Failed to fetch');
      }
      return load.json();
    },
    [integration]
  );
  return {
    get,
  };
};
