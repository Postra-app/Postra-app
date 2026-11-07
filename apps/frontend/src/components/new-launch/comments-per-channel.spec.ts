import { valuesForChannel } from './comments-per-channel';

describe('valuesForChannel', () => {
  const values = [{ content: 'post' }, { content: 'first comment' }, { content: 'second' }];

  it('sends the post and its comments to a channel that takes comments', () => {
    expect(valuesForChannel(values, true)).toEqual(values);
  });

  it('sends only the post to a channel without comments', () => {
    expect(valuesForChannel(values, false)).toEqual([{ content: 'post' }]);
  });

  it('leaves a post without comments as it is', () => {
    expect(valuesForChannel([{ content: 'post' }], false)).toEqual([{ content: 'post' }]);
  });
});
