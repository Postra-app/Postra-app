// Crash/refresh insurance for the design editor: the working canvas is
// snapshotted to localStorage so closing the modal, refreshing, or switching
// the Graphics/Video tab doesn't silently destroy the design. One draft per
// organization — a newer snapshot replaces the older one.

export interface StudioDraft {
  canvasJson: string;
  platformKey: string;
  savedAt: number;
  /**
   * A carousel keeps every slide, the one on screen included, and which one
   * that was. Only the canvas used to be saved, so a refresh brought back one
   * slide of five (E2E-06-23).
   */
  slides?: (string | null)[];
  slideIndex?: number;
}

/** The slides to keep in a draft, with the live canvas in place of its stale copy. */
export const draftSlides = (
  liveJson: string,
  carousel: {
    isCarouselMode: boolean;
    slides: { canvasJson: string | null }[];
    currentSlideIndex: number;
  }
): (string | null)[] | undefined =>
  carousel.isCarouselMode && carousel.slides.length > 1
    ? carousel.slides.map((s, i) =>
        i === carousel.currentSlideIndex ? liveJson : s.canvasJson
      )
    : undefined;

/** Whether a canvas JSON has anything drawn on it. */
export const jsonHasObjects = (json: string | null): boolean => {
  if (!json) return false;
  try {
    const objects = JSON.parse(json)?.objects;
    return Array.isArray(objects) && objects.length > 0;
  } catch {
    return false;
  }
};

const DRAFT_PREFIX = 'postra:studio-draft:';

// localStorage gives a page about 5MB in total, shared with everything else the
// app keeps there. A canvas JSON above this (background removal embeds the cut
// out image as a data-URL, which alone is megabytes) is not worth the whole
// budget, so it is skipped — but the editor is told, because silently not
// saving is how a design gets lost on a refresh.
const MAX_DRAFT_BYTES = 3_500_000;

/** What actually happened, so the editor can say so instead of pretending. */
export type DraftSaveResult = 'saved' | 'too-large' | 'unavailable';

const key = (orgId: string) => `${DRAFT_PREFIX}${orgId || 'default'}`;

export const readDraft = (orgId: string): StudioDraft | null => {
  try {
    const raw = window.localStorage.getItem(key(orgId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudioDraft;
    if (
      typeof parsed?.canvasJson !== 'string' ||
      !parsed.canvasJson ||
      typeof parsed?.platformKey !== 'string'
    ) {
      return null;
    }
    // A malformed slide list is dropped, not trusted: the canvas still restores.
    if (
      parsed.slides !== undefined &&
      !(
        Array.isArray(parsed.slides) &&
        parsed.slides.length > 1 &&
        parsed.slides.every((x) => x === null || typeof x === 'string')
      )
    ) {
      delete parsed.slides;
      delete parsed.slideIndex;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const writeDraft = (orgId: string, draft: StudioDraft): DraftSaveResult => {
  if (draft.canvasJson.length > MAX_DRAFT_BYTES) return 'too-large';
  try {
    window.localStorage.setItem(key(orgId), JSON.stringify(draft));
    return 'saved';
  } catch {
    // quota exceeded / private mode — autosave is best-effort
    return 'unavailable';
  }
};

export const clearDraft = (orgId: string): void => {
  try {
    window.localStorage.removeItem(key(orgId));
  } catch {
    // private mode — nothing to clear
  }
};
