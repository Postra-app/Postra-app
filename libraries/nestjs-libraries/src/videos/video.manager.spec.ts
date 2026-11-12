import 'reflect-metadata';
import { VideoAbstract } from './video.interface';
import { VideoManager } from './video.manager';

// The list of video engines leaves out the ones that are not available, but
// lookup by name did not: the public API's POST /video/function ran
// `image-text-slides` functions (an ElevenLabs call) although that engine is
// switched off, and generate-video answered "not found" only for names that do
// not exist at all. An engine that is not available is not there.
describe('VideoManager.getVideoByName', () => {
  class On {}
  class Off {}
  const original = Reflect.getMetadata('video', VideoAbstract);

  beforeAll(() => {
    Reflect.defineMetadata(
      'video',
      [
        { identifier: 'on', target: On, available: true },
        { identifier: 'off', target: Off, available: false },
      ],
      VideoAbstract
    );
  });

  afterAll(() => {
    Reflect.defineMetadata('video', original, VideoAbstract);
  });

  const manager = new VideoManager({
    get: (target: any) => new target(),
  } as any);

  it('finds an available engine', () => {
    expect(manager.getVideoByName('on')?.instance).toBeInstanceOf(On);
  });

  it('does not find an engine that is not available', () => {
    expect(manager.getVideoByName('off')).toBeUndefined();
  });

  it('does not find an unknown engine', () => {
    expect(manager.getVideoByName('nope')).toBeUndefined();
  });
});
