import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  VideoAbstract,
  VideoParams,
} from '@gitroom/nestjs-libraries/videos/video.interface';

@Injectable()
export class VideoManager {
  constructor(private _moduleRef: ModuleRef) {}

  getAllVideos(): {
    identifier: string;
    title: string;
    dto: any;
    description: string;
    target: VideoAbstract<any>,
    tools: { functionName: string; output: string }[];
    placement: string;
    trial: boolean;
  }[] {
    return (Reflect.getMetadata('video', VideoAbstract) || [])
      .filter((f: any) => f.available)
      .map((p: any) => ({
        target: p.target,
        identifier: p.identifier,
        title: p.title,
        tools: p.tools,
        dto: p.dto,
        description: p.description,
        placement: p.placement,
        trial: p.trial,
      }));
  }

  /**
   * Methods decorated with @ExposeVideoFunction, i.e. the only ones callable
   * by name from the API. Callers must resolve the requested name against
   * this list instead of indexing the instance with raw user input.
   */
  listExposedVideoFunctions(instance: any): string[] {
    const proto = Object.getPrototypeOf(instance) || {};
    return Object.getOwnPropertyNames(proto).filter(
      (name) =>
        name !== 'constructor' &&
        typeof instance[name] === 'function' &&
        !!Reflect.getMetadata('video-function', instance[name])
    );
  }

  getVideoByName(
    identifier: string
  ): (VideoParams & { instance: VideoAbstract<any> }) | undefined {
    const video = (Reflect.getMetadata('video', VideoAbstract) || []).find(
      (p: any) => p.identifier === identifier
    );
    // The signature has always promised undefined for an unknown identifier,
    // but the code dereferenced it regardless — so a typo in the request came
    // back as a TypeError 500 instead of the caller's own "not found".
    // An engine that is not available is not offered (getAllVideos), so it
    // must not be callable by name either: POST /video/function reached the
    // functions of a switched-off engine.
    if (!video || !video.available) {
      return undefined;
    }

    return {
      ...video,
      instance: this._moduleRef.get(video.target, {
        strict: false,
      }),
    };
  }
}
