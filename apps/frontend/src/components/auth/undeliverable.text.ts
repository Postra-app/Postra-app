import type { useT } from '@gitroom/react/translation/get.transation.service.client';

// When the mail server drops mail to the address, so a sign-in link would
// never arrive. The backend sends the same in
// English for clients that do not translate.
export const undeliverableText = (t: ReturnType<typeof useT>) =>
  t(
    'email_undeliverable',
    "Emails to this address are bouncing, so we can't send you the link. Check it for typos or use a different address. Need help? Write to hello@postra.co.uk."
  );
