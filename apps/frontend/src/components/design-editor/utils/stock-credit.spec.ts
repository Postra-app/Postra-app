import { canvasJsonCredits } from './stock-credit';

// Unsplash approves production use only if a post with one of its photos
// credits the photographer. Studio exports a new picture, so the credit is
// read from the design.
describe('photographer credits in a Studio design', () => {
  const a = 'Photo by Ana Lens (@ana.lens) on Unsplash';
  const b = 'Photo by Bo Light on Unsplash';

  it('finds the credit of every stock photo layer, nested ones too, once each', () => {
    const json = JSON.stringify({
      objects: [
        { type: 'Image', studioCredit: a },
        { type: 'Group', objects: [{ type: 'Image', studioCredit: b }, { type: 'Image', studioCredit: a }] },
        { type: 'Textbox', text: 'Hello' },
      ],
    });
    expect(canvasJsonCredits(json)).toEqual([a, b]);
  });

  it('finds none in a design without stock photos, or in no design', () => {
    expect(canvasJsonCredits(JSON.stringify({ objects: [{ type: 'Rect' }] }))).toEqual([]);
    expect(canvasJsonCredits(null)).toEqual([]);
    expect(canvasJsonCredits('not json')).toEqual([]);
  });
});
