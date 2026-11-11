// "Choose from the library" anywhere in the app opens one shared media box,
// mounted by the layout. That box is loaded lazily, so a click made before it
// had loaded used to go nowhere: no window, no message. A request made before
// the box listens now waits and is answered as soon as it does.

export type MediaPick = (media: { id: string; path: string }[]) => void;

let listener: ((pick: MediaPick) => void) | null = null;
let waiting: MediaPick | null = null;
let wake: (() => void) | null = null;

export const requestMediaBox = (pick: MediaPick) => {
  if (listener) {
    listener(pick);
    return;
  }
  waiting = pick;
  wake?.();
};

// The box itself brings the uploader (Uppy, ~140 KB gzip). The layout mounts
// it only once something asks for it, so no page pays for it up front; the
// request waits above until the box listens.
export const whenMediaBoxRequested = (load: () => void) => {
  wake = load;
  if (waiting) {
    load();
  }
  return () => {
    if (wake === load) {
      wake = null;
    }
  };
};

// The library hands back the list of chosen files (MediaBox.addMedia), not one
// file: callers read the first. Lives here, not in media.component, so a
// button that only asks for the box does not bring Uppy into its page.
export const showMediaBox = (
  callback: (params: { id: string; path: string }[]) => void
) => {
  requestMediaBox(callback);
};

export const listenForMediaBox = (open: (pick: MediaPick) => void) => {
  listener = open;
  if (waiting) {
    const pick = waiting;
    waiting = null;
    open(pick);
  }
  return () => {
    if (listener === open) {
      listener = null;
    }
  };
};
