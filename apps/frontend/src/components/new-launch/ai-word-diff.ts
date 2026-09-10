// Word-level diff for the AI ribbon preview: the user has to see what the
// model changed before it touches their post. Written here rather than pulled
// from npm — the shapes we need are a handful of segments, and a new front-end
// dependency before launch buys nothing.

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

// A token is a word plus the whitespace that follows it, so joining the
// segments back together reproduces the text exactly.
const tokenize = (text: string): string[] => text.match(/\S+\s*/g) ?? [];

// Comparison ignores the trailing whitespace only. Case and punctuation are
// real differences and stay visible.
const key = (token: string) => token.trim();

// Above this the O(n*m) table stops being free (1200x1200 is already ~1.4M
// cells) and a post that long is not something anyone reads word by word.
// Both sides are then shown whole instead of diffed.
export const DIFF_TOKEN_LIMIT = 1200;

export const diffWords = (before: string, after: string): DiffSegment[] => {
  const a = tokenize(before);
  const b = tokenize(after);

  if (!a.length && !b.length) return [];
  if (!a.length) return [{ kind: 'add', text: b.join('') }];
  if (!b.length) return [{ kind: 'del', text: a.join('') }];

  if (a.length > DIFF_TOKEN_LIMIT || b.length > DIFF_TOKEN_LIMIT) {
    return [
      { kind: 'del', text: a.join('') },
      { kind: 'add', text: b.join('') },
    ];
  }

  // Longest common subsequence over tokens, walked back into segments.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        key(a[i]) === key(b[j])
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out: DiffSegment[] = [];
  const push = (kind: DiffKind, text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) {
      // Keep the new side's spacing: it is what gets applied.
      push('same', b[j]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push('del', a[i]);
      i++;
    } else {
      push('add', b[j]);
      j++;
    }
  }
  while (i < a.length) push('del', a[i++]);
  while (j < b.length) push('add', b[j++]);

  return out;
};

/**
 * How much of the new text was already in the old one, 0..1. Translate rewrites
 * every word, and an inline diff of two different languages is noise — the
 * preview uses this to open on the plain new text instead.
 */
export const diffSimilarity = (segments: DiffSegment[]): number => {
  let same = 0;
  let total = 0;
  for (const segment of segments) {
    const length = key(segment.text).length;
    if (segment.kind === 'same') same += length;
    if (segment.kind !== 'del') total += length;
  }
  return total ? same / total : 1;
};
