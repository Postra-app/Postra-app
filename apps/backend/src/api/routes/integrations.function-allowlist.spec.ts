import 'reflect-metadata';
import { Tool } from '@gitroom/nestjs-libraries/integrations/tool.decorator';

jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isCallableProviderFunction } = require('./integrations.controller');

// E2E-02-08: POST /integrations/function ran any truthy property of the
// provider named by the client.
class FakeProvider {
  @Tool({ description: 'Channels', dataSchema: [] })
  async channels(): Promise<string[]> {
    return [];
  }
  async pages(): Promise<string[]> {
    return [];
  }
  async post(): Promise<string[]> {
    return [];
  }
  async refreshToken(): Promise<object> {
    return {};
  }
}

describe('POST /integrations/function allowlist', () => {
  const provider = new FakeProvider();

  it('runs @Tool methods and the composer pickers', () => {
    expect(isCallableProviderFunction(provider, 'channels')).toBe(true);
    expect(isCallableProviderFunction(provider, 'pages')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const name of ['post', 'refreshToken', 'constructor', 'toString', 'hasOwnProperty', '__proto__', 'missing', 42]) {
      expect(isCallableProviderFunction(provider, name)).toBe(false);
    }
  });
});

// Every picker the composer calls must still pass on every provider that has it.
describe('the composer\'s calls on the real providers', () => {
  const USED = ['boards', 'channels', 'companies', 'company', 'creatorInfo', 'experiences', 'groups', 'label', 'list', 'organizations', 'pages', 'postTypes', 'publications', 'restrictions', 'subreddits', 'tags', 'teams', 'templates'];
  it('are all allowed where the provider defines them', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { socialIntegrationList } = require('@gitroom/nestjs-libraries/integrations/integration.manager');
    const refused: string[] = [];
    let checked = 0;
    for (const provider of socialIntegrationList) {
      for (const name of USED) {
        if (typeof provider[name] !== 'function') continue;
        checked++;
        if (!isCallableProviderFunction(provider, name)) refused.push(`${provider.identifier}.${name}`);
      }
    }
    expect(checked).toBeGreaterThan(15);
    expect(refused).toEqual([]);
  });
});
