import dayjs from 'dayjs';
import { composerWork, ComposerWork } from './unsaved-work';

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
});
