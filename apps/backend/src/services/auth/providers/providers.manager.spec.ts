import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { AuthProviderManager, signInOffered } from './providers.manager';
import './wallet.provider';
import './farcaster.provider';
import './github.provider';
import './google.provider';

// The app offers sign-in by password and with Google. The routes also took
// a wallet signature and a Farcaster signer: an account with no address,
// active at once, as many as anyone liked.
describe('which ways of signing in exist', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const manager = () => new AuthProviderManager({ get: (target: unknown) => ({ target }) } as any);

  it.each(['WALLET', 'FARCASTER'])('%s is not one of them', (provider) => {
    delete process.env.ENABLE_WEB3_SIGN_IN;
    expect(() => manager().getProvider(provider)).toThrow(NotFoundException);
  });

  it('unless an operator switches it on', () => {
    process.env.ENABLE_WEB3_SIGN_IN = 'true';
    expect(manager().getProvider('WALLET')).toBeTruthy();
  });

  it('GitHub only with its client configured', () => {
    delete process.env.GITHUB_CLIENT_ID;
    expect(() => manager().getProvider('GITHUB')).toThrow(NotFoundException);
    expect(signInOffered('GITHUB', { GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' } as any)).toBe(true);
  });

  it('Google is', () => {
    expect(manager().getProvider('GOOGLE')).toBeTruthy();
  });
});
