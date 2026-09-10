import { planUpload } from './result-plan';

const three = [{ key: '9x16' }, { key: '1x1' }, { key: '16x9' }];

describe('planUpload', () => {
  it('keeps every file and attaches the chosen one', () => {
    // The old behaviour attached all three to a post that takes one video.
    expect(planUpload(three, '1x1', 'post')).toEqual({
      toUpload: ['9x16', '1x1', '16x9'],
      toAttach: '1x1',
    });
  });

  it('falls back to the first result rather than doing nothing', () => {
    expect(planUpload(three, null, 'post').toAttach).toBe('9x16');
    expect(planUpload(three, 'a-format-that-went-away', 'post').toAttach).toBe('9x16');
  });

  it('attaches nothing when the user only asked to save', () => {
    expect(planUpload(three, '1x1', 'library')).toEqual({
      toUpload: ['9x16', '1x1', '16x9'],
      toAttach: null,
    });
  });

  it('treats a single render the same way', () => {
    expect(planUpload([{ key: 'clip' }], null, 'post')).toEqual({
      toUpload: ['clip'],
      toAttach: 'clip',
    });
  });

  it('does nothing when there is no result', () => {
    expect(planUpload([], 'clip', 'post')).toEqual({ toUpload: [], toAttach: null });
  });
});
