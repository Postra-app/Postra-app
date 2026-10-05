const store = new Map<string, string>();
(globalThis as any).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
};

import { draftSlides, jsonHasObjects, readDraft, writeDraft } from './draft-autosave';

// E2E-06-23: a carousel draft kept only the slide on screen.
const canvas = (n: number) => JSON.stringify({ objects: Array.from({ length: n }, () => ({ type: 'textbox' })) });

describe('carousel drafts', () => {
  it('keeps every slide, with the live canvas in place of its stale copy', () => {
    const slides = draftSlides(canvas(2), {
      isCarouselMode: true,
      slides: [{ canvasJson: canvas(1) }, { canvasJson: 'stale' }, { canvasJson: null }],
      currentSlideIndex: 1,
    });
    expect(slides).toEqual([canvas(1), canvas(2), null]);
  });

  it('a single design has no slide list', () => {
    expect(draftSlides(canvas(1), { isCarouselMode: true, slides: [{ canvasJson: null }], currentSlideIndex: 0 })).toBeUndefined();
    expect(draftSlides(canvas(1), { isCarouselMode: false, slides: [], currentSlideIndex: 0 })).toBeUndefined();
  });

  it('tells an empty slide from one with something on it', () => {
    expect(jsonHasObjects(canvas(0))).toBe(false);
    expect(jsonHasObjects(canvas(1))).toBe(true);
    expect(jsonHasObjects(null)).toBe(false);
    expect(jsonHasObjects('not json')).toBe(false);
  });

  it('reads the slides back, and drops a malformed list instead of trusting it', () => {
    writeDraft('org', { canvasJson: canvas(1), platformKey: 'ig', savedAt: 1, slides: [canvas(1), null], slideIndex: 1 });
    expect(readDraft('org')).toMatchObject({ slides: [canvas(1), null], slideIndex: 1 });

    window.localStorage.setItem(
      'postra:studio-draft:org',
      JSON.stringify({ canvasJson: canvas(1), platformKey: 'ig', savedAt: 1, slides: [42], slideIndex: 0 })
    );
    const draft = readDraft('org');
    expect(draft?.canvasJson).toBe(canvas(1));
    expect(draft?.slides).toBeUndefined();
  });
});
