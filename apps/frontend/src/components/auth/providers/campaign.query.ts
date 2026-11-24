import {
  signupSourceFromParams,
  signupSourceQuery,
} from '@gitroom/helpers/utils/signup.source';

// The campaign parameters of the page the visitor is on, to send with the
// request for a sign-in link. The backend keeps them with the sign-in state
// while the visitor is at the provider, so nothing is stored in the browser.
export const campaignQuery = () =>
  typeof window === 'undefined'
    ? ''
    : signupSourceQuery(
        signupSourceFromParams(new URLSearchParams(window.location.search))
      );
