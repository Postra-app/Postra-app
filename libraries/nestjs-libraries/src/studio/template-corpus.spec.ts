import { templateCorpus } from './template-corpus';

describe('templateCorpus', () => {
  it('is stable regardless of the order entries arrive in', () => {
    const a = templateCorpus([
      { id: 'b', text: 'Second' },
      { id: 'a', text: 'First' },
    ]);
    const b = templateCorpus([
      { id: 'a', text: 'First' },
      { id: 'b', text: 'Second' },
    ]);
    expect(a).toBe(b);
  });

  // The texts are translated, so the same ids in another language have to hash
  // to something different - otherwise a Polish search matches English
  // embeddings, which is the bug the id-only key used to have.
  it('changes when the texts change', () => {
    expect(templateCorpus([{ id: 'a', text: 'Promo' }])).not.toBe(
      templateCorpus([{ id: 'a', text: 'Promocja' }])
    );
  });

  it('separates id from text so a shifted boundary cannot collide', () => {
    expect(templateCorpus([{ id: 'ab', text: 'c' }])).not.toBe(
      templateCorpus([{ id: 'a', text: 'bc' }])
    );
  });

  it('handles an empty catalogue', () => {
    expect(templateCorpus([])).toBe('');
  });
});
