import type dayjs from 'dayjs';

// What the composer holds that closing it, or reloading the page, would
// lose: the content of every block, the media, the channels, and when and
// how the post goes out. The composer compares this with what it opened
// with, and only then asks.
// The content keeps what the post publishes with: paragraph breaks and
// bold, italic and underline. Only what the editor adds without changing the
// post (attributes, entities, spacing) is left out.
// Provider settings (a YouTube title, a Pinterest board) live in each
// provider's own form; that form tells whether they changed
// (`settingsChanged` in high.order.provider.tsx, compared with stableJson).

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

// One pass can rebuild a tag from nested markup (<scr<script>ipt>), so the
// stripping repeats until nothing changes. A typed "<" is &lt; in the
// editor's HTML, so a bracket left after that is markup too.
const withoutTags = (html: string) => {
  let previous: string;
  let current = html;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);
  return current.replace(/[<>]/g, '');
};

const text = (html?: string) =>
  withoutTags(
    (html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h[1-6]|li|blockquote|div)>/gi, '\n')
      .replace(/<\/?(strong|b)\b[^>]*>/gi, '**')
      .replace(/<\/?(em|i)\b[^>]*>/gi, '_')
      .replace(/<\/?u\b[^>]*>/gi, '__')
  )
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

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

// JSON with the keys of every object in order, so the same settings read
// twice compare equal whatever order the form returned them in.
export const stableJson = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.keys(v)
          .sort()
          .reduce((acc, k) => {
            acc[k] = (v as Record<string, unknown>)[k];
            return acc;
          }, {} as Record<string, unknown>)
      : v
  ) ?? 'null';
