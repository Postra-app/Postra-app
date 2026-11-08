import { aiCooldownMessage } from './ai.cooldown';

describe('aiCooldownMessage', () => {
  const now = Date.parse('2030-01-01T12:00:00Z');
  it('says how long is left', () => {
    expect(aiCooldownMessage(new Date(now - 10 * 60_000), now)).toBe(
      'AI tools unlock one hour after signup, in 50 minutes. Try our templates in the meantime!'
    );
  });
  it('says "1 minute"', () => {
    expect(aiCooldownMessage(new Date(now - 59.5 * 60_000), now)).toContain('in 1 minute.');
  });
  it('is quiet after the hour and without a date', () => {
    expect(aiCooldownMessage(new Date(now - 61 * 60_000), now)).toBeNull();
    expect(aiCooldownMessage(undefined, now)).toBeNull();
  });
});
