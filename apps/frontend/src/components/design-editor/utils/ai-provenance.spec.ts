import { canvasJsonHasAi } from './ai-provenance';

const json = (objects: unknown[], extra: object = {}) =>
  JSON.stringify({ version: '7', objects, ...extra });

describe('canvasJsonHasAi (E2E-06-04)', () => {
  it('is true when any layer came from an image model', () => {
    expect(
      canvasJsonHasAi(
        json([
          { type: 'Image', studioAiGenerated: true },
          { type: 'Textbox', text: 'Autumn coffee' },
        ])
      )
    ).toBe(true);
  });

  it('finds an AI layer inside a group', () => {
    expect(
      canvasJsonHasAi(
        json([{ type: 'Group', objects: [{ type: 'Image', studioAiGenerated: true }] }])
      )
    ).toBe(true);
  });

  it('is false for a design with no AI layer', () => {
    expect(
      canvasJsonHasAi(json([{ type: 'Image' }, { type: 'Textbox', text: 'Hi' }]))
    ).toBe(false);
  });

  it('is false for nothing or for something that is not JSON', () => {
    expect(canvasJsonHasAi(undefined)).toBe(false);
    expect(canvasJsonHasAi('not json')).toBe(false);
  });
});
