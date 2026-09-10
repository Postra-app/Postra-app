import {
  primaryFamily,
  fontSpecifiers,
  familiesInUse,
  ensureFontsLoaded,
  remeasureText,
  loadCanvasFonts,
} from './font-loading';

describe('primaryFamily', () => {
  it('takes the first family of a stack', () => {
    expect(primaryFamily('Geist, system-ui, sans-serif')).toBe('Geist');
  });

  it('keeps quotes around families that need them', () => {
    expect(primaryFamily('"Open Sans", sans-serif')).toBe('"Open Sans"');
    expect(primaryFamily("'DM Sans', sans-serif")).toBe('"DM Sans"');
  });

  it('survives an empty stack', () => {
    expect(primaryFamily('')).toBe('');
  });
});

describe('fontSpecifiers', () => {
  it('asks for the two weights Fabric draws', () => {
    expect(fontSpecifiers('Geist, sans-serif')).toEqual([
      '400 16px Geist',
      '700 16px Geist',
    ]);
  });

  it('asks for nothing when there is no family', () => {
    expect(fontSpecifiers('')).toEqual([]);
  });
});

describe('familiesInUse', () => {
  it('deduplicates and ignores objects without a family', () => {
    expect(
      familiesInUse([
        { fontFamily: 'Geist, sans-serif' },
        { fontFamily: 'Geist, sans-serif' },
        { fontFamily: '  ' },
        {},
        { fontFamily: 'Lato, sans-serif' },
      ])
    ).toEqual(['Geist, sans-serif', 'Lato, sans-serif']);
  });
});

describe('ensureFontsLoaded', () => {
  const fakeFonts = (impl?: (spec: string) => Promise<unknown>) => {
    const calls: string[] = [];
    return {
      calls,
      set: {
        load: (spec: string) => {
          calls.push(spec);
          return impl ? impl(spec) : Promise.resolve([]);
        },
      } as unknown as FontFaceSet,
    };
  };

  it('loads both weights of every family', async () => {
    const { calls, set } = fakeFonts();
    await ensureFontsLoaded(['Geist, sans-serif', '"Open Sans", sans-serif'], set);
    expect(calls).toEqual([
      '400 16px Geist',
      '700 16px Geist',
      '400 16px "Open Sans"',
      '700 16px "Open Sans"',
    ]);
  });

  it('skips generic families, which have no face to fetch', async () => {
    const { calls, set } = fakeFonts();
    await ensureFontsLoaded(['sans-serif', 'system-ui'], set);
    expect(calls).toEqual([]);
  });

  // A font the browser cannot fetch used to be able to reject the whole
  // await, which would have stopped a template from ever being applied.
  it('resolves even when a face fails', async () => {
    const { set } = fakeFonts((spec) =>
      spec.includes('Missing') ? Promise.reject(new Error('no such face')) : Promise.resolve([])
    );
    await expect(
      ensureFontsLoaded(['Missing, sans-serif', 'Geist, sans-serif'], set)
    ).resolves.toBeUndefined();
  });

  it('does nothing when the document has no font set', async () => {
    await expect(ensureFontsLoaded(['Geist'], undefined)).resolves.toBeUndefined();
  });
});

describe('remeasureText', () => {
  it('re-measures only what can be measured', () => {
    const measured: string[] = [];
    const touched = remeasureText([
      { fontFamily: 'Geist', initDimensions: () => measured.push('a'), setCoords: () => undefined },
      { fontFamily: 'Geist' },
      { fontFamily: 'Lato', initDimensions: () => measured.push('b') },
    ]);
    expect(touched).toBe(2);
    expect(measured).toEqual(['a', 'b']);
  });
});

describe('loadCanvasFonts', () => {
  it('loads the families on the canvas and repaints once', async () => {
    let renders = 0;
    const objects = [
      { fontFamily: 'Geist, sans-serif', initDimensions: () => undefined },
      { fontFamily: 'Lato, sans-serif', initDimensions: () => undefined },
    ];
    const loaded: string[] = [];
    const originalFonts = (global as { document?: Document }).document;
    (global as unknown as { document: { fonts: unknown } }).document = {
      fonts: {
        load: (spec: string) => {
          loaded.push(spec);
          return Promise.resolve([]);
        },
      },
    } as never;

    await loadCanvasFonts({
      getObjects: () => objects,
      requestRenderAll: () => {
        renders++;
      },
    });

    expect(loaded).toHaveLength(4);
    expect(renders).toBe(1);
    (global as { document?: Document }).document = originalFonts as Document;
  });

  it('stays quiet on a canvas with no text', async () => {
    let renders = 0;
    await loadCanvasFonts({
      getObjects: () => [{ type: 'image' }],
      requestRenderAll: () => {
        renders++;
      },
    });
    expect(renders).toBe(0);
  });
});
