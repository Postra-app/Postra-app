// @ts-ignore
import twitter from 'twitter-text';

export const textSlicer = (
  integrationType: string,
  end: number,
  text: string
): { start: number; end: number } => {
  if (integrationType !== 'x') {
    return {
      start: 0,
      end,
    };
  }

  const { validRangeEnd, valid } = twitter.parseTweet(text, {
    version: 3,
    maxWeightedTweetLength: end,
    scale: 100,
    defaultWeight: 200,
    emojiParsingEnabled: true,
    transformedURLLength: 23,
    ranges: [
      { start: 0, end: 4351, weight: 100 },
      { start: 8192, end: 8205, weight: 100 },
      { start: 8208, end: 8223, weight: 100 },
      { start: 8242, end: 8247, weight: 100 },
    ],
  });

  return {
    start: 0,
    end: valid ? end : validRangeEnd,
  };
};

export const weightedLength = (text: string): number => {
  return twitter.parseTweet(text).weightedLength;
};

const graphemeCount = (text: string): number => {
  const Segmenter = (Intl as any).Segmenter;
  if (typeof Segmenter === 'function') {
    let n = 0;
    for (const _ of new Segmenter(undefined, { granularity: 'grapheme' }).segment(
      text
    )) {
      n++;
    }
    return n;
  }
  return Array.from(text).length;
};

const URL_RE = /https?:\/\/\S+/gi;

// How each platform itself counts a post against its limit, so the composer
// counter and the server check agree with the platform instead of rejecting
// posts it would accept (E2E-05-04, E2E-05-07):
// - X: twitter-text weighting — every link is 23, emoji and CJK weigh 2;
// - Mastodon: every link is 23, the rest in characters (graphemes);
// - Bluesky: graphemes, links in full (no shortener);
// - everyone else: plain string length, as before.
export const providerTextLength = (
  identifier: string | undefined,
  text: string
): number => {
  const value = text || '';
  switch ((identifier || '').split('-')[0]) {
    case 'x':
      return weightedLength(value);
    case 'mastodon':
      return graphemeCount(value.replace(URL_RE, 'x'.repeat(23)));
    case 'bluesky':
      return graphemeCount(value);
    default:
      return value.length;
  }
};
