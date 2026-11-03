import type dayjs from 'dayjs';

// What the composer holds that closing it, or reloading the page, would
// lose: the text of every block (as text, so the editor rewriting the same
// words as other HTML is no change), the media, the channels, and when and
// how the post goes out. The composer compares this with what it opened
// with, and only then asks.
// Provider settings (a YouTube title, a Pinterest board) live in each
// provider's own form, not in the store, and are not part of it: without
// text or media none of them can be published anyway.

interface Value {
  content?: string;
  delay?: number;
  media?: { id?: string; path?: string }[];
}

export interface ComposerWork {
  global: Value[];
  internal: { integration?: { id?: string }; integrationValue: Value[] }[];
  selectedIntegrations: { integration?: { id?: string } }[];
  tags: { value: string }[];
  repeater?: number;
  date?: dayjs.Dayjs;
  channelDates: Record<string, dayjs.Dayjs>;
}

const text = (html?: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const values = (list?: Value[]) =>
  (list || []).map((v) => ({
    text: text(v.content),
    media: (v.media || []).map((m) => m.id || m.path || ''),
    delay: v.delay || 0,
  }));

const minute = (d?: dayjs.Dayjs) => (d ? d.format('YYYY-MM-DDTHH:mm') : '');

export const composerWork = (state: ComposerWork) =>
  JSON.stringify({
    global: values(state.global),
    internal: (state.internal || [])
      .map((i) => ({ id: i.integration?.id || '', values: values(i.integrationValue) }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    channels: (state.selectedIntegrations || [])
      .map((i) => i.integration?.id || '')
      .sort(),
    tags: (state.tags || []).map((t) => t.value).sort(),
    repeater: state.repeater || 0,
    date: minute(state.date),
    channelDates: Object.keys(state.channelDates || {})
      .sort()
      .map((id) => [id, minute(state.channelDates[id])]),
  });
