import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthProviderAbstract } from '@gitroom/backend/services/auth/providers.interface';

// Sign-in by wallet signature and by Farcaster signer came with the fork.
// The app offers neither, but the routes took them: an account made with a
// keypair is active at once, has no address to confirm and passes every
// check a sign-up by e-mail meets, as many times as anyone likes; the
// wallet's signed message names no site, so a signature made anywhere else
// works here. They exist only where an operator switches them on. GitHub
// needs its client, without which it cannot tell whose token it holds.
export const signInOffered = (
  provider: string,
  env: NodeJS.ProcessEnv = process.env
) => {
  if (provider === 'WALLET' || provider === 'FARCASTER') {
    return env.ENABLE_WEB3_SIGN_IN === 'true';
  }
  if (provider === 'GITHUB') {
    return !!env.GITHUB_CLIENT_ID && !!env.GITHUB_CLIENT_SECRET;
  }
  return true;
};

@Injectable()
export class AuthProviderManager {
  constructor(private _moduleRef: ModuleRef) {}

  getProvider(provider: string): AuthProviderAbstract {
    const metadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    const found = metadata.find(
      (m: any) => m.provider === provider
    );

    if (!found || !signInOffered(provider)) {
      // A bare Error leaves the route as an unhandled 500, which files a Sentry
      // issue for every bot that walks /auth/oauth/<anything>. An unknown
      // provider is a bad URL, not a server fault — say so with a 404.
      throw new NotFoundException(`Auth provider ${provider} not found`);
    }

    return this._moduleRef.get(found.target, { strict: false });
  }
}
