import { allProviders } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { LinkedinProvider } from './linkedin.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { MastodonProvider } from './mastodon.provider';

// A post's settings are checked against the DTO in all.providers.settings, but
// the public API's GET /integration-settings/:id and the MCP integrationSchema
// read the provider's own `dto`. LinkedIn and Mastodon had none, so both said
// "No additional settings required" while the carousel and the visibility
// options exist. Each provider names the DTO its settings are checked with.
describe('provider settings DTO', () => {
  const dtoFor = (name: string) =>
    allProviders().find((p: { name: string }) => p.name === name)?.value;

  it.each([
    ['linkedin', () => new LinkedinProvider()],
    ['linkedin-page', () => new LinkedinPageProvider()],
    ['mastodon', () => new MastodonProvider()],
  ])('%s has the same DTO as its settings', (name, make) => {
    expect(dtoFor(name)).toBeDefined();
    expect((make() as { dto?: unknown }).dto).toBe(dtoFor(name));
  });
});
