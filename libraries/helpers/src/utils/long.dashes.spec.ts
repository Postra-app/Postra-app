import { withoutLongDashes, deepWithoutLongDashes } from './long.dashes';

// K. 10-09: no long dashes in anything a customer reads — our texts and the
// AI's suggestions alike. They become a plain hyphen.
describe('withoutLongDashes', () => {
  it.each([
    ['Create one in Studio — or pick a stock photo', 'Create one in Studio - or pick a stock photo'],
    ['Create one in Studio—or pick a stock photo', 'Create one in Studio - or pick a stock photo'],
    ['5–10 days', '5-10 days'],
    ['Mon – Fri', 'Mon - Fri'],
    ['— Kris', '- Kris'],
    ['Line one\n— two', 'Line one\n- two'],
    ['Done —', 'Done -'],
    ['No dashes here - fine', 'No dashes here - fine'],
  ])('%j → %j', (input, output) => {
    expect(withoutLongDashes(input)).toBe(output);
  });
});

describe('deepWithoutLongDashes', () => {
  it('cleans every string in an AI answer, and leaves the rest', () => {
    expect(
      deepWithoutLongDashes({ caption: 'One — two', slides: [{ headline: 'A–B' }, 3], ok: true, none: null })
    ).toEqual({ caption: 'One - two', slides: [{ headline: 'A - B' }, 3], ok: true, none: null });
  });
});
