// "Choose from the library" anywhere in the app opens one shared media box,
// mounted by the layout. That box is loaded lazily, so a click made before it
// had loaded used to go nowhere: no window, no message. A request made before
// the box listens now waits and is answered as soon as it does.

export type MediaPick = (media: { id: string; path: string }[]) => void;

let listener: ((pick: MediaPick) => void) | null = null;
let waiting: MediaPick | null = null;

export const requestMediaBox = (pick: MediaPick) => {
  if (listener) {
    listener(pick);
    return;
  }
  waiting = pick;
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
