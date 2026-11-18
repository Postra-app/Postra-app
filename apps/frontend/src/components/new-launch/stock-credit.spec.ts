import { creditsAsHtml, creditsToAdd } from './stock-credit';

// Unsplash approves production use only if a post with one of its photos
// credits the photographer in the post text.
describe('stock photo credits in the post text', () => {
  const credit = 'Photo by Stack Lens (@stack.lens) on Unsplash';

  it('adds the credit of a photo put into the post', () => {
    expect(creditsToAdd([{ credit }], 'Fresh bread this morning')).toEqual([credit]);
  });

  it('does not add it twice', () => {
    expect(creditsToAdd([{ credit }], `Fresh bread\n\n${credit}`)).toEqual([]);
    expect(creditsToAdd([{ credit }, { credit }], '')).toEqual([credit]);
  });

  it('adds each line of a design that carries several', () => {
    const other = 'Photo by Bo Light on Unsplash';
    expect(creditsToAdd([{ credit: `${credit}\n${other}` }], '')).toEqual([credit, other]);
    expect(creditsAsHtml([{ credit: 'Photo by A & <B> on Unsplash' }])).toBe(
      '<p>Photo by A &amp; &lt;B&gt; on Unsplash</p>'
    );
  });

  it('adds nothing for files without a credit', () => {
    expect(creditsToAdd([{}, { credit: null }, { credit: '  ' }], '')).toEqual([]);
    expect(creditsToAdd(undefined, '')).toEqual([]);
  });
});
