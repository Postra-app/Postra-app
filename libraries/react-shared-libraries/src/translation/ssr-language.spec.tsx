import React, { FC } from 'react';
import { renderToString } from 'react-dom/server';
import i18next from './i18next';
import { useT } from './get.transation.service.client';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';

// The server has no browser to detect a language from, so the login page was
// rendered in English for a Polish browser, which then rendered Polish over it:
// React #418 on every Polish visit (Sentry POSTRA-E, 2026-10-26). The server
// render has to use the language the layout resolved.
const SignIn: FC = () => {
  const t = useT();
  return <h1>{t('sign_in', 'Sign In')}</h1>;
};

const render = (language: string) =>
  renderToString(
    <VariableContextComponent {...({ language } as any)}>
      <SignIn />
    </VariableContextComponent>
  );

describe('server render language', () => {
  beforeAll(async () => {
    if (!i18next.isInitialized) {
      await new Promise((resolve) => i18next.on('initialized', resolve));
    }
    await i18next.loadLanguages(['en', 'pl']);
    expect(i18next.hasResourceBundle('pl', 'translation')).toBe(true);
  });

  it('a Polish visitor gets Polish from the server', () => {
    expect(typeof window).toBe('undefined');
    expect(render('pl')).toContain('Zaloguj się');
  });

  it('an English visitor gets English', () => {
    expect(render('en')).toContain('Sign In');
  });

  it('one request does not change the language of the next', () => {
    render('pl');
    expect(render('en')).toContain('Sign In');
    expect(render('pl')).toContain('Zaloguj się');
  });
});
