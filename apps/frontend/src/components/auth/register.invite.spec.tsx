/**
 * @jest-environment jsdom
 */
// While sign-ups are closed (before launch) the sign-up page shows the form
// only to people an admin promised a plan to: through the link from the
// admin panel (?invite), or coming back from Google when the backend says
// that address may sign up. Everyone else sees "Sign-ups are closed".
let query = new URLSearchParams();
const exists = jest.fn();

jest.mock('next/navigation', () => ({
  useSearchParams: () => query,
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({
    isGeneral: true,
    genericOauth: false,
    disableRegistration: true,
  }),
}));
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));
jest.mock('@gitroom/helpers/utils/custom.fetch', () => ({
  useFetch: () => exists,
}));
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

const CLOSED = 'Sign-ups are closed';
const backendSays = (body: object) =>
  exists.mockResolvedValue({ ok: true, json: async () => body });

afterEach(() => {
  cleanup();
  exists.mockReset();
});

describe('sign-up page while sign-ups are closed', () => {
  it('without the invitation link: closed', () => {
    query = new URLSearchParams();
    render(<Register />);
    expect(screen.getByText(CLOSED)).toBeTruthy();
  });

  it('with the invitation link: the form', () => {
    query = new URLSearchParams('invite');
    render(<Register />);
    expect(screen.queryByText(CLOSED)).toBeNull();
    expect(document.querySelector('input[name="email"]')).toBeTruthy();
  });

  it('back from Google with an address that may sign up: the form', async () => {
    query = new URLSearchParams('provider=google&code=c1&state=s1');
    backendSays({ token: 't1', canRegister: true });
    render(<Register />);
    await waitFor(() => expect(document.querySelector('input[name="company"]')).toBeTruthy());
    expect(screen.queryByText(CLOSED)).toBeNull();
  });

  it('back from Google with any other address: closed', async () => {
    query = new URLSearchParams('provider=google&code=c1&state=s1');
    backendSays({ token: 't1', canRegister: false });
    render(<Register />);
    await waitFor(() => expect(screen.getByText(CLOSED)).toBeTruthy());
  });
});
