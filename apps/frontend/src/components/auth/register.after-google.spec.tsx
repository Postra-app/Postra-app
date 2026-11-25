/**
 * @jest-environment jsdom
 */
// Back from Google without an account: the page showed the bare sign-up form
// (a "Continue With" heading over nothing, no word that Google worked), and
// someone who only wanted to sign in could not tell what had happened.
let query = new URLSearchParams();
const exists = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => query,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ isGeneral: true, genericOauth: false, disableRegistration: false }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string, values: Record<string, string> = {}) =>
    text.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => values[k] ?? ''),
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({ useFetch: () => exists }));
jest.mock('@gitroom/react/helpers/use.track', () => ({ useTrack: () => jest.fn() }));
jest.mock('@gitroom/helpers/utils/use.fire.events', () => ({ useFireEvents: () => jest.fn() }));
jest.mock('react-use-cookie', () => () => ['', jest.fn()]);
jest.mock('@gitroom/frontend/components/auth/providers/google.provider', () => ({
  GoogleProvider: () => <span>Google</span>,
}));
jest.mock('@gitroom/frontend/components/auth/providers/github.provider', () => ({
  GithubProvider: () => <span>GitHub</span>,
}));
jest.mock('@gitroom/frontend/components/auth/providers/oauth.provider', () => ({
  OauthProvider: () => <span>OAuth</span>,
}));

import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { Register } from './register';

const backendSays = (body: object) => exists.mockResolvedValue({ ok: true, json: async () => body });

beforeEach(() => {
  query = new URLSearchParams('provider=google&code=abc&state=s');
});
afterEach(() => {
  cleanup();
  exists.mockReset();
});

describe('the sign-up page on the way back from Google', () => {
  it('a new person is told Google worked, with which address, and what is left to do', async () => {
    backendSays({ token: 'tok', canRegister: true, email: 'new@example.com' });
    render(<Register />);
    await waitFor(() => expect(screen.getByText('One more step')).toBeTruthy());
    expect(screen.getByTestId('after-provider-note').textContent).toBe(
      'You are signed in with Google as new@example.com. You do not have a Postra account yet: add your company name and accept the terms to create one.'
    );
    expect(screen.queryByText('Continue With')).toBeNull();
    expect(screen.getByText('Already have an account with a password?')).toBeTruthy();
  });

  it('an address with a password account is sent to sign in, not to sign up again', async () => {
    backendSays({ passwordAccount: true });
    render(<Register />);
    await waitFor(() => expect(screen.getByTestId('provider-sign-in-failed')).toBeTruthy());
    expect(screen.getByTestId('provider-sign-in-failed').textContent).toContain(
      'This email already has a Postra account with a password. Sign in with your email and password instead.'
    );
    expect(screen.queryByText('One more step')).toBeNull();
  });
});
