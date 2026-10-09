import { cspViolations, CspReportLog } from './csp.report';

// The app's Content-Security-Policy starts report-only: browsers POST what
// the policy would have blocked, and we log it once per kind, without query
// strings (a URL can carry a token), before the policy is enforced.
describe('CSP reports', () => {
  it('reads a report-uri report (application/csp-report)', () => {
    expect(
      cspViolations({
        'csp-report': {
          'document-uri': 'https://app.postra.pl/launches?token=secret',
          'effective-directive': 'script-src-elem',
          'violated-directive': 'script-src-elem',
          'blocked-uri': 'https://evil.example/x.js?k=1',
          'source-file': 'https://app.postra.pl/_next/static/chunks/a.js',
          'line-number': 3,
          disposition: 'report',
        },
      })
    ).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'https://evil.example/x.js',
        page: '/launches',
        source: 'https://app.postra.pl/_next/static/chunks/a.js:3',
      },
    ]);
  });

  it('reads Reporting API reports (application/reports+json)', () => {
    expect(
      cspViolations([
        {
          type: 'csp-violation',
          url: 'https://app.postra.pl/media',
          body: {
            effectiveDirective: 'img-src',
            blockedURL: 'https://cdn.example/a.png',
            disposition: 'report',
          },
        },
        { type: 'deprecation', body: {} },
      ])
    ).toEqual([
      { directive: 'img-src', blocked: 'https://cdn.example/a.png', page: '/media', source: '' },
    ]);
  });

  it('ignores what is not a report', () => {
    expect(cspViolations(undefined)).toEqual([]);
    expect(cspViolations('text')).toEqual([]);
    expect(cspViolations({ other: 1 })).toEqual([]);
  });

  it('logs each kind once, and stays bounded', () => {
    const lines: string[] = [];
    const log = new CspReportLog((line) => lines.push(line), 2);
    const v = { directive: 'img-src', blocked: 'https://a.example/x.png', page: '/', source: '' };
    log.add(v);
    log.add(v);
    log.add({ ...v, page: '/media' });
    log.add({ ...v, blocked: 'https://b.example/y.png' });
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('[csp] img-src blocked=https://a.example/x.png page=/');
  });
});
