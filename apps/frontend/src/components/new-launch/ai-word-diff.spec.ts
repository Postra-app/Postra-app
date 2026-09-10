import {
  DIFF_TOKEN_LIMIT,
  diffSimilarity,
  diffWords,
} from './ai-word-diff';

const rebuild = (before: string, after: string) => {
  const segments = diffWords(before, after);
  return {
    old: segments
      .filter((s) => s.kind !== 'add')
      .map((s) => s.text)
      .join(''),
    new: segments
      .filter((s) => s.kind !== 'del')
      .map((s) => s.text)
      .join(''),
  };
};

describe('diffWords', () => {
  it('marks nothing when the text is unchanged', () => {
    expect(diffWords('one two three', 'one two three')).toEqual([
      { kind: 'same', text: 'one two three' },
    ]);
  });

  it('marks a replaced word on both sides', () => {
    expect(diffWords('buy our shoes', 'buy our boots')).toEqual([
      { kind: 'same', text: 'buy our ' },
      { kind: 'del', text: 'shoes' },
      { kind: 'add', text: 'boots' },
    ]);
  });

  it('marks an insertion without touching the words around it', () => {
    expect(diffWords('summer sale', 'summer clearance sale')).toEqual([
      { kind: 'same', text: 'summer ' },
      { kind: 'add', text: 'clearance ' },
      { kind: 'same', text: 'sale' },
    ]);
  });

  it('marks a deletion', () => {
    expect(diffWords('our very best offer', 'our best offer')).toEqual([
      { kind: 'same', text: 'our ' },
      { kind: 'del', text: 'very ' },
      { kind: 'same', text: 'best offer' },
    ]);
  });

  it('treats a case change as a real difference', () => {
    expect(diffWords('summer sale', 'Summer sale')).toEqual([
      { kind: 'del', text: 'summer ' },
      { kind: 'add', text: 'Summer ' },
      { kind: 'same', text: 'sale' },
    ]);
  });

  it('reproduces both sides exactly, so nothing is lost in the preview', () => {
    const before = 'Book your ride today.\nWe drive across London.';
    const after = 'Book your airport ride today.\nWe drive across London and Kent.';
    const out = rebuild(before, after);
    expect(out.old.replace(/\s+/g, ' ').trim()).toBe(
      before.replace(/\s+/g, ' ').trim()
    );
    expect(out.new.replace(/\s+/g, ' ').trim()).toBe(
      after.replace(/\s+/g, ' ').trim()
    );
  });

  it('handles an empty side', () => {
    expect(diffWords('', 'new text')).toEqual([{ kind: 'add', text: 'new text' }]);
    expect(diffWords('old text', '')).toEqual([{ kind: 'del', text: 'old text' }]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('falls back to whole-side blocks above the token limit', () => {
    const long = 'word '.repeat(DIFF_TOKEN_LIMIT + 1);
    const segments = diffWords(long, long);
    expect(segments.map((s) => s.kind)).toEqual(['del', 'add']);
  });
});

describe('diffSimilarity', () => {
  it('is 1 when nothing changed', () => {
    expect(diffSimilarity(diffWords('one two', 'one two'))).toBe(1);
  });

  it('is 0 when every word was replaced', () => {
    expect(diffSimilarity(diffWords('one two', 'trzy cztery'))).toBe(0);
  });

  it('sits in between for a partial rewrite', () => {
    const value = diffSimilarity(diffWords('buy our shoes', 'buy our boots'));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
  });
});
