// jest-environment-jsdom bundles jsdom 20, which crashes loading the optional
// native `canvas` module; the repo's own jsdom 22 does not, so set it up here.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://app.postra.co.uk/auth/login',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

import React, { FC, Suspense } from 'react';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, render, screen } = require('@testing-library/react');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const i18next = require('./i18next').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useT } = require('./get.transation.service.client');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const variables = require('@gitroom/react/helpers/variable.context');
const { VariableContextComponent } = variables;

// The server renders the language the layout resolved; the browser detects
// its own (here jsdom's en-US) and i18next keeps it until the new language's
// resources arrive. Rendering in the meantime showed English over Polish
// server text: React #418 (Sentry POSTRA-E). The browser must render the
// server's language or nothing.
const SignIn: FC = () => {
  const t = useT();
  return <h1>{t('sign_in', 'Sign In')}</h1>;
};

describe('browser start language', () => {
  beforeAll(async () => {
    if (!i18next.isInitialized) {
      await new Promise((resolve) => i18next.on('initialized', resolve));
    }
    await i18next.changeLanguage('en');
    expect(i18next.hasResourceBundle('pl', 'translation')).toBe(false);
  });

  it('never renders another language than the server', async () => {
    render(
      <VariableContextComponent {...({ language: 'pl' } as any)}>
        <Suspense fallback={<p>loading</p>}>
          <SignIn />
        </Suspense>
      </VariableContextComponent>
    );
    expect(screen.queryByText('Sign In')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => i18next.on('languageChanged', resolve));
    });
    expect(screen.getByText('Zaloguj się')).toBeTruthy();
  });
});
