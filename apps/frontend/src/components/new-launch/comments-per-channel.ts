/**
 * What a channel publishes of the composer's values: the post first, then its
 * comments. A platform with no comment API (TikTok, Pinterest, YouTube) gets
 * the post alone. The global tab writes one set of values for every channel
 * and already tells the customer these channels take no comments; sending
 * the comments anyway parked them as failed on the published post.
 */
export const valuesForChannel = <T>(values: T[], supportsComments: boolean): T[] =>
  supportsComments ? values : values.slice(0, 1);
