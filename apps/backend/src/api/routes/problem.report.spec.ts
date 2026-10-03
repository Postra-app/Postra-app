import { problemReportHtml } from './problem.report';

describe('problem report email', () => {
  it('escapes everything the reporter typed', () => {
    const html = problemReportHtml({
      message: '<img src=x onerror=alert(1)> broke',
      name: '<b>Ann</b>',
      email: 'ann@example.com',
      organization: 'Acme & Co',
      page: '/billing?x="y"',
      eventId: 'a'.repeat(32),
    });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; broke');
    expect(html).toContain('Acme &amp; Co');
    expect(html).toContain('&quot;y&quot;');
    expect(html).toContain('a'.repeat(32));
  });

  it('leaves out page and event lines when absent', () => {
    const html = problemReportHtml({ message: 'hi', email: 'a@b.co', organization: 'O' });
    expect(html).not.toContain('Page:');
    expect(html).not.toContain('Sentry event');
  });
});
