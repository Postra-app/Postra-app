import * as fabric from 'fabric/node';
import { installStudioFabricMetadata, wireStudioIds } from './fabric-studio-metadata';
import { useEditorStore } from '../editor.store';

// The module under test patches the prototype of 'fabric'; in Node that has
// to be the same build the test makes its objects with.
jest.mock('fabric', () => jest.requireActual('fabric/node'));

type WithId = fabric.FabricObject & { studioId?: string };

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

describe('wireStudioIds', () => {
  // AI edits address layers by id. A duplicate or a paste carried its
  // original's id, so the two were one layer to the AI.
  it('gives a copy that arrives with a taken id an id of its own', () => {
    const canvas = new fabric.StaticCanvas(undefined, { width: 100, height: 100, renderOnAddRemove: false });
    wireStudioIds(canvas as unknown as Parameters<typeof wireStudioIds>[0]);
    const original = new fabric.Rect({ width: 10, height: 10 }) as WithId;
    canvas.add(original);
    expect(original.studioId).toBeTruthy();

    const copy = new fabric.Rect({ width: 10, height: 10 }) as WithId;
    copy.studioId = original.studioId;
    canvas.add(copy);
    expect(copy.studioId).toBeTruthy();
    expect(copy.studioId).not.toBe(original.studioId);
  });

  it('keeps the id of an object that is the only one with it', () => {
    const canvas = new fabric.StaticCanvas(undefined, { width: 100, height: 100, renderOnAddRemove: false });
    wireStudioIds(canvas as unknown as Parameters<typeof wireStudioIds>[0]);
    const restored = new fabric.Rect({ width: 10, height: 10 }) as WithId;
    restored.studioId = 'layer_saved';
    canvas.add(restored);
    expect(restored.studioId).toBe('layer_saved');
  });
});

describe('installStudioFabricMetadata', () => {
  // A layer locked in the Layers panel cannot be selected or clicked. Fabric
  // left both flags out of its JSON, so undo, a refresh or the restored
  // draft brought it back unlocked.
  it('keeps a locked layer locked through the design JSON', async () => {
    installStudioFabricMetadata();
    const canvas = new fabric.StaticCanvas(undefined, { width: 100, height: 100, renderOnAddRemove: false });
    const locked = new fabric.Rect({ width: 10, height: 10, selectable: false, evented: false });
    const free = new fabric.Rect({ width: 10, height: 10, left: 20 });
    canvas.add(locked, free);
    const json = canvas.toJSON() as { objects: Record<string, unknown>[] };
    expect(json.objects.map((o) => [o.selectable, o.evented])).toEqual([
      [false, false],
      [true, true],
    ]);

    // What loadFromJSON does with each object, without a drawing context.
    const again = await fabric.util.enlivenObjects<fabric.FabricObject>(
      JSON.parse(JSON.stringify(json)).objects
    );
    expect(again.map((o) => [o.selectable, o.evented])).toEqual([
      [false, false],
      [true, true],
    ]);
  });
});

describe('pushHistory', () => {
  // A commit that changed nothing was an undo step that did nothing.
  it('does not record the same design twice in a row', () => {
    const store = useEditorStore.getState();
    store.resetHistory();
    store.pushHistory('a');
    store.pushHistory('b');
    store.pushHistory('b');
    expect(useEditorStore.getState().history).toEqual(['a', 'b']);
    expect(useEditorStore.getState().undo()).toBe('a');
  });
});
