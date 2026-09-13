import { Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthProviderAbstract } from '@gitroom/backend/services/auth/providers.interface';

@Injectable()
export class AuthProviderManager {
  constructor(private _moduleRef: ModuleRef) {}

  getProvider(provider: string): AuthProviderAbstract {
    const metadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    const found = metadata.find(
      (m: any) => m.provider === provider
    );

    if (!found) {
      // A bare Error leaves the route as an unhandled 500, which files a Sentry
      // issue for every bot that walks /auth/oauth/<anything>. An unknown
      // provider is a bad URL, not a server fault — say so with a 404.
      throw new NotFoundException(`Auth provider ${provider} not found`);
    }

    return this._moduleRef.get(found.target, { strict: false });
  }
}
