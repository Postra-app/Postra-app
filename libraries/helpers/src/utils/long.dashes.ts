// K. 10-09: no long dashes (em — or en –) in anything a customer reads, our
// texts and the AI's alike. Between digits a dash is a range (5-10); at the
// start of a line it is a bullet ("- item"); elsewhere it reads as a pause
// and becomes " - ".
export const withoutLongDashes = (text: string): string =>
  text.replace(/[ \t]*[—–][ \t]*/g, (match, offset: number, whole: string) => {
    const before = whole[offset - 1];
    const after = whole[offset + match.length];
    if (before && after && /\d/.test(before) && /\d/.test(after)) {
      return '-';
    }
    if (offset === 0 || before === '\n') {
      return after === undefined || after === '\n' ? '-' : '- ';
    }
    if (after === undefined || after === '\n') {
      return ' -';
    }
    return ' - ';
  });

// The same for an AI answer of any shape: every string in it, nested or not.
export const deepWithoutLongDashes = <T>(value: T): T => {
  if (typeof value === 'string') {
    return withoutLongDashes(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => deepWithoutLongDashes(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, deepWithoutLongDashes(v)])
    ) as T;
  }
  return value;
};
