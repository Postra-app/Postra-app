import * as fabric from 'fabric';

let installed = false;

/**
 * Fabric ships a light-UI selection: a pale blue dashed border with white
 * square handles. On Studio's dark canvas inside a dark app that reads as a
 * stray artefact rather than "this object is selected".
 *
 * Set the defaults once, before any canvas is built, so every object - text,
 * image, shape, icon, group - selects the same way, in the brand accent.
 *
 * Idempotent: `ownDefaults` is a shared prototype object.
 */
export const installStudioFabricControls = (): void => {
  if (installed) return;
  installed = true;

  Object.assign(fabric.FabricObject.ownDefaults, {
    // filled circles read as grab handles; hollow squares read as decoration
    transparentCorners: false,
    cornerStyle: 'circle' as const,
    cornerColor: '#ffffff',
    cornerStrokeColor: '#38bdf8',
    cornerSize: 10,
    // a coarse pointer needs a bigger hit area than the drawn handle
    touchCornerSize: 24,
    borderColor: '#38bdf8',
    borderScaleFactor: 1.5,
    // breathing room so the border does not sit on the artwork's own edge
    padding: 2,
    // keep the outline readable while dragging instead of fading it out
    borderOpacityWhenMoving: 0.7,
  });
};
