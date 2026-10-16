// The controller reaches every provider; nostr-tools ships ESM that jest does
// not parse. Nothing here touches a provider.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import { PATH_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';

// Upstream 668c97117: /user/agent-media-sso signed the organization id and
// name with a third-party key and sent the user to agent-media.ai. Nothing in
// Postra calls it and the key was never set; the route is gone.
describe('UsersController routes', () => {
  it('has no agent-media-sso route', () => {
    const proto = UsersController.prototype as any;
    const paths = Object.getOwnPropertyNames(proto)
      .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name]))
      .filter(Boolean);
    expect(paths).toContain('/self');
    expect(paths).not.toContain('/agent-media-sso');
  });
});
