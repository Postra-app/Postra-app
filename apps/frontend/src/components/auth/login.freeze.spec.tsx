/**
 * @jest-environment jsdom
 */
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
  useFetch: () => jest.fn(),
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { Login } from './login';

// While sign-ups are closed, an existing account that signs in with Google
// still needs the button: the backend lets it through.
describe('login while sign-ups are closed', () => {
  it('still offers Google, and no sign-up link', () => {
    const html = renderToStaticMarkup(<Login />);
    expect(html).toContain('Continue With');
    expect(html).toContain('Google');
    expect(html).not.toContain('/auth/register');
  });
});
