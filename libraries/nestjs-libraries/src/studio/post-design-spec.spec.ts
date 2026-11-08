import { DESIGN_FORMATS } from './design-formats';
import { platformDesignSize, safeDesignColors } from './post-design-spec';

describe('safeDesignColors', () => {
  it('keeps hex colours as the model gave them', () => {
    expect(safeDesignColors({ background: '#112233', accent: '#abc', text: ' #FFFFFF ' })).toEqual({
      background: '#112233',
      accent: '#abc',
      text: '#FFFFFF',
    });
  });

  // The canvas throws on a colour it cannot parse, mid-render.
  it('replaces what is not a hex colour with the brand colour, then a default', () => {
    expect(
      safeDesignColors(
        { background: 'dark navy', accent: 'rgb(1,2,3', text: '' },
        { primary: '#ff0066', secondary: 'not a colour', text: '#eeeeee' }
      )
    ).toEqual({ background: '#1a1a2e', accent: '#ff0066', text: '#eeeeee' });
    expect(safeDesignColors(undefined)).toEqual({
      background: '#1a1a2e',
      accent: '#38bdf8',
      text: '#ffffff',
    });
  });
});

describe('platformDesignSize', () => {
  // The editor sends its format key. The background is made in the shape this
  // returns, so an X post that got the 4:5 default had a portrait picture
  // cropped to a strip.
  it('gives every Studio format its own size', () => {
    for (const f of DESIGN_FORMATS) {
      expect([f.key, platformDesignSize(f.key)]).toEqual([f.key, { width: f.width, height: f.height }]);
    }
    expect(platformDesignSize('x-post')).toEqual({ width: 1600, height: 900 });
    expect(platformDesignSize('pinterest-pin')).toEqual({ width: 1000, height: 1500 });
  });

  it('still sizes a channel name the way it always did', () => {
    expect(platformDesignSize('x')).toEqual({ width: 1600, height: 900 });
    expect(platformDesignSize('facebook')).toEqual({ width: 1080, height: 1350 });
    expect(platformDesignSize('tiktok')).toEqual({ width: 1080, height: 1920 });
    expect(platformDesignSize('pinterest')).toEqual({ width: 1000, height: 1500 });
    expect(platformDesignSize(undefined)).toEqual({ width: 1080, height: 1350 });
  });
});
