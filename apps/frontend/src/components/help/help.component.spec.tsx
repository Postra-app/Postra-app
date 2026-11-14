/**
 * @jest-environment jsdom
 */
jest.mock('@gitroom/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, text: string) => text,
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { HelpComponent } from './help.component';

// The contents list left out "Studio - Photos": the section was on the page,
// but nobody reading the list knew it was there. Every top-level section of
// the page has its entry, in the order the page shows them.
describe('Help contents list', () => {
  const html = renderToStaticMarkup(<HelpComponent />);
  // A Section is the only element with this class next to its id.
  const sectionIds = [
    ...html.matchAll(/<div id="([a-z-]+)" class="flex flex-col gap-\[16px\]"/g),
  ].map((m) => m[1]);
  const tocIds = [...html.matchAll(/href="#([a-z-]+)"/g)]
    .map((m) => m[1])
    .filter((id) => !id.startsWith('channel-'));

  it('lists every section of the page', () => {
    expect(sectionIds).toContain('studio-photos');
    expect(tocIds).toEqual(sectionIds);
  });
});

// A "Soon" platform (LinkedIn Page) has no tile in Add Channel for a
// customer, so Help has no card for it either; a super admin sees both.
describe('Help channel cards', () => {
  const { UserContext } = jest.requireActual('@gitroom/frontend/components/layout/user.context');
  const render = (isSuperAdmin: boolean) =>
    renderToStaticMarkup(
      <UserContext.Provider value={{ isSuperAdmin } as any}>
        <HelpComponent />
      </UserContext.Provider>
    );

  it('a customer gets no card for a platform still coming', () => {
    const html = render(false);
    expect(html).toContain('id="channel-linkedin"');
    expect(html).not.toContain('id="channel-linkedin-page"');
    expect(html).not.toMatch(/Coming soon: new LinkedIn Page connections/);
  });

  it('a super admin still gets it', () => {
    expect(render(true)).toContain('id="channel-linkedin-page"');
  });
});
