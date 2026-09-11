import {
  normalizeSearch,
  searchNeedsUpdate,
} from '@gitroom/frontend/components/admin/use-debounced-search';

// E2E-09-16: both admin tables refetched on every keystroke and sent the raw
// value, so typing an eleven-character email fired eleven paged queries, each
// with a `contains` scan and — in Organizations — three correlated counts per
// row. A trailing space from a paste matched nothing.

describe('what reaches the query', () => {
  it('drops the whitespace a paste brings with it', () => {
    expect(normalizeSearch('  kris@example.com  ')).toBe('kris@example.com');
  });

  it('treats whitespace alone as no search', () => {
    expect(normalizeSearch('   ')).toBe('');
    expect(normalizeSearch('')).toBe('');
  });

  it('leaves an ordinary term as it is', () => {
    expect(normalizeSearch('acme')).toBe('acme');
  });
});

describe('when a request is worth making', () => {
  it('is not, while the settled value already matches', () => {
    expect(searchNeedsUpdate('acme', 'acme')).toBe(false);
    expect(searchNeedsUpdate('  acme  ', 'acme')).toBe(false);
  });

  it('is, once the term actually changed', () => {
    expect(searchNeedsUpdate('acm', 'acme')).toBe(true);
    expect(searchNeedsUpdate('acme', '')).toBe(true);
  });

  it('is, when the box is cleared back to nothing', () => {
    expect(searchNeedsUpdate('', 'acme')).toBe(true);
    expect(searchNeedsUpdate('   ', 'acme')).toBe(true);
  });
});
