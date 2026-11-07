import { safeDesignColors } from './post-design-spec';

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
