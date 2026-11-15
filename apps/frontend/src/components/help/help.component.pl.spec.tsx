/**
 * @jest-environment jsdom
 */
// The Help page for a reader whose language is Polish: t() answers from the
// Polish catalogue, the way i18next does, placeholders filled. No card may
// stay in English (Help was English only until 15 XI 2026).
import pl from '@gitroom/react/translation/locales/pl/translation.json';

jest.mock('@gitroom/react/translation/get.transation.service.client', () => {
  const catalogue = jest.requireActual('@gitroom/react/translation/locales/pl/translation.json');
  return {
    useT: () => (key: string, text: string, values?: Record<string, unknown>) =>
      String(catalogue[key] ?? text).replace(/\{\{\s*(\w+)\s*\}\}/g, (all: string, name: string) =>
        values && name in values ? String(values[name]) : all
      ),
  };
});

import { renderToStaticMarkup } from 'react-dom/server';
import { HelpComponent } from './help.component';
import { CHANNEL_GUIDES, FAQ_ITEMS, SETTINGS_SECTIONS } from './help.data';

describe('Help in Polish', () => {
  const html = renderToStaticMarkup(<HelpComponent />)
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');

  it('shows the Polish text of every kind of card', () => {
    expect(html).toContain(pl.help_ch_telegram_step_0);
    expect(html).toContain(pl.help_faq_0_q);
    expect(html).toContain(pl.help_set_0_desc);
    expect(html).toContain(pl.help_mobile_intro);
    expect(html).toContain(pl.help_start_step_0);
    expect(html).toContain(pl.help_connect_oauth);
  });

  it('shows no English sentence of the guides', () => {
    const english = [
      ...CHANNEL_GUIDES.flatMap((c) => [...c.steps, ...c.gotchas, ...(c.composer || [])]),
      ...FAQ_ITEMS.flatMap((f) => [f.question, f.answer]),
      ...SETTINGS_SECTIONS.map((s) => s.description),
      'Which sections you see depends on your plan.',
      'Content coming soon.',
    ];
    expect(english.filter((text) => html.includes(text))).toEqual([]);
  });

  it('fills the plan numbers, no raw placeholders', () => {
    expect(html).not.toContain('{{');
  });
});
