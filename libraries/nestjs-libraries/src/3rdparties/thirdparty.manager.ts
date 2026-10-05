import { Injectable } from '@nestjs/common';
import {
  ThirdPartyAbstract,
  ThirdPartyParams,
} from '@gitroom/nestjs-libraries/3rdparties/thirdparty.interface';
import { ModuleRef } from '@nestjs/core';
import { ThirdPartyService } from '@gitroom/nestjs-libraries/database/prisma/third-party/third-party.service';

@Injectable()
export class ThirdPartyManager {
  constructor(
    private _moduleRef: ModuleRef,
    private _thirdPartyService: ThirdPartyService
  ) {}

  getAllThirdParties(): any[] {
    return (Reflect.getMetadata('third:party', ThirdPartyAbstract) || []).map(
      (p: any) => ({
        identifier: p.identifier,
        title: p.title,
        description: p.description,
        fields: p.fields || [],
      })
    );
  }

  getThirdPartyByName(
    identifier: string
  ): (ThirdPartyParams & { instance: ThirdPartyAbstract }) | undefined {
    const thirdParty = (
      Reflect.getMetadata('third:party', ThirdPartyAbstract) || []
    ).find((p: any) => p.identifier === identifier);

    // An unknown name was read as `undefined.target`, a 500 before the
    // callers' own "Invalid identifier" answer could run (API-14).
    if (!thirdParty) {
      return undefined;
    }
    return { ...thirdParty, instance: this._moduleRef.get(thirdParty.target) };
  }

  // Lifecycle methods stay off the public /third-party/function/:id/:name
  // route: checkConnection runs on /add, sendData on /:id/submit.
  private static readonly NOT_CALLABLE_BY_NAME = new Set([
    'constructor',
    'checkConnection',
    'sendData',
  ]);

  /**
   * Provider methods that may be invoked by name from the API. Callers must
   * resolve the requested name against this list (never index the instance
   * with raw user input) so `constructor`/inherited properties are unreachable.
   */
  listCallableFunctions(instance: ThirdPartyAbstract): string[] {
    return Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter(
      (name) =>
        !ThirdPartyManager.NOT_CALLABLE_BY_NAME.has(name) &&
        typeof (instance as any)[name] === 'function'
    );
  }

  deleteIntegration(org: string, id: string) {
    return this._thirdPartyService.deleteIntegration(org, id);
  }

  getIntegrationById(org: string, id: string) {
    return this._thirdPartyService.getIntegrationById(org, id);
  }

  getAllThirdPartiesByOrganization(org: string) {
    return this._thirdPartyService.getAllThirdPartiesByOrganization(org);
  }

  saveIntegration(
    org: string,
    identifier: string,
    apiKey: string,
    data: { name: string; username: string; id: string }
  ) {
    return this._thirdPartyService.saveIntegration(
      org,
      identifier,
      apiKey,
      data
    );
  }
}
