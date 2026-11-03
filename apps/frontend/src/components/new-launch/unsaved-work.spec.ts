import dayjs from 'dayjs';
import { composerWork, ComposerWork, stableJson } from './unsaved-work';

const opened = (): ComposerWork => ({
  global: [{ content: '<p></p><p>Thanks, the team</p>', delay: 0, media: [] }],
  internal: [],
  selectedIntegrations: [{ integration: { id: 'a' } }],
  tags: [],
  repeater: undefined,
  date: dayjs('2026-11-04T09:00:00'),
  channelDates: {},
});

describe('composer work (what closing would lose)', () => {
  it('is the same when the editor only rewrites the HTML of the same text', () => {
    const later = opened();
    later.global[0].content = '<p>Thanks,&nbsp;the   team</p>';
    expect(composerWork(later)).toBe(composerWork(opened()));
  });

  it('changes with text, media, channels, tags, repeat, date and per-channel text', () => {
    const base = composerWork(opened());
    const changes: ((s: ComposerWork) => void)[] = [
      (s) => (s.global[0].content += '<p>New offer</p>'),
      (s) => (s.global[0].media = [{ id: 'm1', path: '/m1.png' }]),
      (s) => s.selectedIntegrations.push({ integration: { id: 'b' } }),
      (s) => (s.tags = [{ value: 'promo' }]),
      (s) => (s.repeater = 7),
      (s) => (s.date = dayjs('2026-11-04T10:00:00')),
      (s) =>
        (s.internal = [
          { integration: { id: 'a' }, integrationValue: [{ content: '<p>Only here</p>' }] },
        ]),
      (s) => (s.channelDates = { b: dayjs('2026-11-05T09:00:00') }),
      (s) => s.global.push({ content: '<p>A comment</p>' }),
    ];
    for (const change of changes) {
      const state = opened();
      change(state);
      expect(composerWork(state)).not.toBe(base);
    }
  });

  it('does not depend on the order channels were picked in', () => {
    const one = opened();
    one.selectedIntegrations = [{ integration: { id: 'a' } }, { integration: { id: 'b' } }];
    const two = opened();
    two.selectedIntegrations = [{ integration: { id: 'b' } }, { integration: { id: 'a' } }];
    expect(composerWork(one)).toBe(composerWork(two));
  });

  // The text alone hid changes the post publishes with.
  it('changes when paragraphs are merged or a paragraph is made bold', () => {
    const split = opened();
    split.global[0].content = '<p>First</p><p>Second</p>';
    const merged = opened();
    merged.global[0].content = '<p>First Second</p>';
    expect(composerWork(merged)).not.toBe(composerWork(split));

    const bold = opened();
    bold.global[0].content = '<p></p><p><strong>Thanks, the team</strong></p>';
    expect(composerWork(bold)).not.toBe(composerWork(opened()));
  });

  it('ignores attributes the editor adds to the same paragraphs', () => {
    const later = opened();
    later.global[0].content = '<p dir="auto"></p><p dir="auto">Thanks, the team</p>';
    expect(composerWork(later)).toBe(composerWork(opened()));
  });
});

describe('stableJson (channel settings)', () => {
  it('does not depend on key order, and sees a changed value', () => {
    expect(stableJson({ a: 1, b: { c: 2, d: 3 } })).toBe(stableJson({ b: { d: 3, c: 2 }, a: 1 }));
    expect(stableJson({ visibility: 'public' })).not.toBe(stableJson({ visibility: 'unlisted' }));
  });
});
