// Fabric's browser build needs a DOM; the node build ships its own.
import * as fabric from 'fabric/node';
import { withHistoryPaused, isHistoryPaused } from './canvas-history';

/**
 * The premise of the bug, pinned down: Fabric fires one event per object, so
 * anything that rebuilds the canvas (a template, an AI design, a carousel
 * slide) used to land as a dozen undo steps and could push the state the user
 * wanted back out of the 30-entry history entirely.
 */

type AnyCanvas = fabric.Canvas;

// jsdom has no 2D context and says so on every canvas construction. Nothing
// here draws, so keep the noise out of the test output.
const realError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (String(args[0] ?? '').includes('Not implemented: HTMLCanvasElement')) return;
    realError(...(args as []));
  };
});
afterAll(() => {
  console.error = realError;
});

/** A canvas wired the way the editor wires it: history driven by events. */
const makeCanvas = () => {
  const canvas = new fabric.StaticCanvas(undefined, {
    width: 100,
    height: 100,
    renderOnAddRemove: false,
  }) as unknown as AnyCanvas;
  const history: string[] = [];
  const saveState = () => {
    if (isHistoryPaused(canvas)) return;
    history.push(`entry-${history.length}`);
  };
  (['object:modified', 'object:added', 'object:removed'] as const).forEach((e) =>
    canvas.on(e, saveState)
  );
  return { canvas, history };
};

const addShapes = (canvas: AnyCanvas, n: number) => {
  for (let i = 0; i < n; i += 1) {
    canvas.add(new fabric.Rect({ width: 10, height: 10 }) as never);
  }
};

describe('withHistoryPaused', () => {
  it('confirms the premise: an unguarded bulk add records one entry per object', () => {
    const { canvas, history } = makeCanvas();
    addShapes(canvas, 8);
    expect(history).toHaveLength(8);
  });

  it('records a bulk add as exactly one undo step', async () => {
    const { canvas, history } = makeCanvas();
    await withHistoryPaused(canvas, () => addShapes(canvas, 8));
    expect(history).toHaveLength(1);
    expect(canvas.getObjects()).toHaveLength(8);
  });

  it('records a clear-and-rebuild as one step too', async () => {
    // This is the loadFromJSON shape: remove everything, then add everything.
    const { canvas, history } = makeCanvas();
    await withHistoryPaused(canvas, () => addShapes(canvas, 3));
    await withHistoryPaused(canvas, () => {
      canvas.remove(...canvas.getObjects());
      addShapes(canvas, 5);
    });
    expect(history).toHaveLength(2);
  });

  it('keeps a five-slide carousel inside the history cap', async () => {
    // Five slides × a full rebuild each used to be ~40 entries, which evicted
    // everything the user had before generating.
    const { canvas, history } = makeCanvas();
    await withHistoryPaused(canvas, () => {
      for (let slide = 0; slide < 5; slide += 1) {
        canvas.remove(...canvas.getObjects());
        addShapes(canvas, 7);
      }
    });
    expect(history).toHaveLength(1);
  });

  it('reports the paused state only while the work runs', async () => {
    const { canvas } = makeCanvas();
    expect(isHistoryPaused(canvas)).toBe(false);
    await withHistoryPaused(canvas, () => {
      expect(isHistoryPaused(canvas)).toBe(true);
    });
    expect(isHistoryPaused(canvas)).toBe(false);
  });

  it('returns the callback value and awaits an async one', async () => {
    const { canvas } = makeCanvas();
    const value = await withHistoryPaused(canvas, async () => {
      await Promise.resolve();
      addShapes(canvas, 2);
      return 'kept photo';
    });
    expect(value).toBe('kept photo');
  });

  it('still commits - and un-pauses - when the work throws', async () => {
    // A half-applied template has to stay reachable with Ctrl+Z rather than
    // being stranded outside the history with events switched off.
    const { canvas, history } = makeCanvas();
    await expect(
      withHistoryPaused(canvas, () => {
        addShapes(canvas, 2);
        throw new Error('template blew up');
      })
    ).rejects.toThrow('template blew up');
    expect(isHistoryPaused(canvas)).toBe(false);
    expect(history).toHaveLength(1);
  });

  it('does not un-pause early when nested', async () => {
    // A template that loads JSON pauses inside an already-paused block.
    const { canvas, history } = makeCanvas();
    await withHistoryPaused(canvas, async () => {
      await withHistoryPaused(canvas, () => addShapes(canvas, 3));
      expect(isHistoryPaused(canvas)).toBe(true);
      addShapes(canvas, 3);
    });
    expect(history).toHaveLength(1);
    expect(canvas.getObjects()).toHaveLength(6);
  });

  it('leaves normal single edits recording one entry each', async () => {
    const { canvas, history } = makeCanvas();
    await withHistoryPaused(canvas, () => addShapes(canvas, 4));
    addShapes(canvas, 1);
    canvas.remove(canvas.getObjects()[0]);
    expect(history).toHaveLength(3);
  });
});
