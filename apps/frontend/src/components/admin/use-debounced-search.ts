'use client';

import { useEffect, useState } from 'react';

/**
 * A search box that does not send a request per keystroke.
 *
 * Both admin tables refetched on every character and sent the raw value, so
 * typing an eleven-character email fired eleven queries — each one a paged
 * `findMany` with a `contains` scan and, in Organizations, three correlated
 * counts per row. Untrimmed, a trailing space from a paste also matched
 * nothing (E2E-09-16).
 *
 * Returns the value to bind to the input, a setter, and the settled value to
 * put in the query key.
 */
/**
 * What actually goes into the query. Whitespace only is no search at all, and
 * a trailing space from a paste used to be sent verbatim and match nothing.
 */
export const normalizeSearch = (value: string) => value.trim();

/** True when a settle would change the query, i.e. when it is worth a request. */
export const searchNeedsUpdate = (input: string, settled: string) =>
  normalizeSearch(input) !== settled;

export const useDebouncedSearch = (
  delay = 300
): [string, (value: string) => void, string] => {
  const [input, setInput] = useState('');
  const [settled, setSettled] = useState('');

  useEffect(() => {
    if (!searchNeedsUpdate(input, settled)) {
      return;
    }
    const timer = setTimeout(() => setSettled(normalizeSearch(input)), delay);
    return () => clearTimeout(timer);
  }, [input, settled, delay]);

  return [input, setInput, settled];
};
