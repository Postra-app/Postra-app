import {
  stampPlatform,
  readStampedPlatform,
  platformBySize,
  sameSurface,
  PLATFORM_STAMP_KEY,
} from './canvas-format';
import { PLATFORM_SIZES } from '../editor.store';

const xPost = PLATFORM_SIZES.find((p) => p.key === 'x-post')!;
const igFeed = PLATFORM_SIZES.find((p) => p.key === 'instagram-feed')!;
const canvas = JSON.stringify({ version: '7.0.0', objects: [{ type: 'textbox' }] });

describe('stampPlatform', () => {
  it('adds the format without touching the objects', () => {
    const stamped = JSON.parse(stampPlatform(canvas, xPost));
    expect(stamped.objects).toEqual([{ type: 'textbox' }]);
    expect(stamped[PLATFORM_STAMP_KEY]).toEqual({ ...xPost });
  });

  it('replaces an earlier stamp instead of stacking them', () => {
    const twice = stampPlatform(stampPlatform(canvas, xPost), igFeed);
    expect(JSON.parse(twice)[PLATFORM_STAMP_KEY]).toEqual({ ...igFeed });
  });

  // Losing a design because the stamp could not be written would be a far
  // worse bug than the one this fixes.
  it('returns the input when it is not an object', () => {
    expect(stampPlatform('not json', xPost)).toBe('not json');
    expect(stampPlatform('[1,2]', xPost)).toBe('[1,2]');
  });
});

describe('readStampedPlatform', () => {
  it('round-trips a format', () => {
    expect(readStampedPlatform(stampPlatform(canvas, xPost))).toEqual({
      key: 'x-post',
      label: xPost.label,
      width: 1600,
      height: 900,
    });
  });

  it('returns null for designs saved before the stamp existed', () => {
    expect(readStampedPlatform(canvas)).toBeNull();
  });

  it('returns null for nonsense rather than throwing', () => {
    expect(readStampedPlatform('not json')).toBeNull();
    expect(readStampedPlatform(null)).toBeNull();
    expect(
      readStampedPlatform(JSON.stringify({ [PLATFORM_STAMP_KEY]: { key: 'x' } }))
    ).toBeNull();
    expect(
      readStampedPlatform(
        JSON.stringify({ [PLATFORM_STAMP_KEY]: { key: 'x', label: 'X', width: 0, height: 10 } })
      )
    ).toBeNull();
  });

  it('keeps the size the design was drawn for, not the catalogue size', () => {
    const legacy = JSON.stringify({
      [PLATFORM_STAMP_KEY]: { key: 'x-post', label: 'X Post (16:9)', width: 1200, height: 675 },
    });
    expect(readStampedPlatform(legacy)?.width).toBe(1200);
  });
});

describe('platformBySize', () => {
  it('names a known size', () => {
    expect(platformBySize(1600, 900)?.key).toBe('x-post');
  });

  it('never answers with the custom placeholder', () => {
    expect(platformBySize(1080, 1080)?.key).not.toBe('custom');
  });

  it('returns null for a size we do not offer', () => {
    expect(platformBySize(123, 456)).toBeNull();
  });
});

describe('sameSurface', () => {
  it('compares pixels, not names', () => {
    expect(sameSurface(igFeed, { ...igFeed, key: 'custom', label: 'Custom' })).toBe(true);
    expect(sameSurface(igFeed, xPost)).toBe(false);
  });
});
