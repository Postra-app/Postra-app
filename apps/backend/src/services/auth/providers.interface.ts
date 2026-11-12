import { Injectable } from '@nestjs/common';

export abstract class AuthProviderAbstract {
  abstract generateLink(query?: any, state?: string): Promise<string> | string;
  abstract getToken(code: string, redirectUri?: string): Promise<string>;
  // `verified: false` = the provider has not verified the address (Google
  // says so); such an address does not count as owned.
  abstract getUser(
    providerToken: string
  ): Promise<{ email: string; id: string; verified?: boolean }> | false;
  // Only Google: the ID token from the mobile app's native sign-in.
  verifyIdToken?(
    idToken: string
  ): Promise<{ email: string; id: string } | false>;
  async postRegistration(
    providerToken: string,
    orgId: string
  ): Promise<void> {}
}

export interface AuthProviderParams {
  provider: string;
}

export function AuthProvider(params: AuthProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    existingMetadata.push({ target, provider: params.provider });

    Reflect.defineMetadata(
      'auth-provider',
      existingMetadata,
      AuthProviderAbstract
    );
  };
}
