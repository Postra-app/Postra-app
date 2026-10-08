import { marginAlertMail } from '@gitroom/nestjs-libraries/ai-cost/margin-alert.mail';

describe('margin guard mail', () => {
  it('lists each organisation with its share, and escapes names', () => {
    const { subject, html } = marginAlertMail(
      [{ organizationId: 'o', name: '<b>Evil & Co</b>', tier: 'STANDARD', trial: true, planGbp: 19, costUsd: 19.5, share: 0.766, alert: true }],
      { days: 30, usdPerGbp: 1.34, threshold: 0.7, unknownModels: ['gpt-x'] }
    );
    expect(subject).toBe('Postra margin guard: 1 organisation over 70% of plan price');
    expect(html).toContain('&lt;b&gt;Evil &amp; Co&lt;/b&gt;');
    expect(html).toContain('STANDARD (trial)');
    expect(html).toContain('$19.50');
    expect(html).toContain('<b>77%</b>');
    expect(html).toContain('gpt-x');
  });
});
