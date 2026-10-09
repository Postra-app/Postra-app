// What the browser says the Content-Security-Policy blocked (or would have,
// while it is report-only). Two formats reach us: `report-uri` posts one
// `{"csp-report": {...}}` as application/csp-report, the Reporting API posts
// a list of `{type: "csp-violation", body: {...}}` as application/reports+json.
export type CspViolation = {
  directive: string;
  blocked: string;
  page: string;
  source: string;
};

// Origin and path only: a page or resource URL can carry a token in its
// query string.
const withoutQuery = (url: unknown) => {
  if (typeof url !== 'string' || !url) {
    return '';
  }
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    // "inline", "eval", "data" and the like are not URLs.
    return url.slice(0, 100);
  }
};

const pathOf = (url: unknown) => {
  try {
    return new URL(String(url)).pathname;
  } catch {
    return '';
  }
};

const one = (r: Record<string, any>): CspViolation | undefined => {
  const directive = r['effective-directive'] || r['violated-directive'] || r.effectiveDirective;
  if (typeof directive !== 'string' || !directive) {
    return undefined;
  }
  const file = withoutQuery(r['source-file'] || r.sourceFile);
  const rawLine = r['line-number'] ?? r.lineNumber;
  // Anything but a number is dropped: an object here threw on interpolation
  // and the endpoint answered 500 (Codex).
  const line = Number.isFinite(rawLine) ? rawLine : undefined;
  return {
    directive: directive.split(' ')[0].slice(0, 60),
    blocked: withoutQuery(r['blocked-uri'] || r.blockedURL),
    page: pathOf(r['document-uri'] || r.documentURL),
    source: file ? `${file}${line ? `:${line}` : ''}` : '',
  };
};

export const cspViolations = (body: unknown): CspViolation[] => {
  if (Array.isArray(body)) {
    return body
      .filter((r) => r?.type === 'csp-violation' && r.body)
      .slice(0, 20)
      .map((r) => one({ documentURL: r.url, ...r.body }))
      .filter((v): v is CspViolation => !!v);
  }
  if (body && typeof body === 'object' && (body as any)['csp-report']) {
    const v = one((body as any)['csp-report']);
    return v ? [v] : [];
  }
  return [];
};

// One line per kind of violation (directive, blocked resource, page), so a
// policy that blocks something on every page view does not flood the log.
// The set is bounded and starts over when full.
export class CspReportLog {
  private seen = new Set<string>();

  constructor(
    private write: (line: string) => void,
    private max = 1000
  ) {}

  add(v: CspViolation) {
    const key = `${v.directive}|${v.blocked}|${v.page}`;
    if (this.seen.has(key)) {
      return;
    }
    if (this.seen.size >= this.max) {
      this.seen.clear();
    }
    this.seen.add(key);
    this.write(
      `[csp] ${v.directive} blocked=${v.blocked || '-'} page=${v.page || '-'}${
        v.source ? ` source=${v.source}` : ''
      }`
    );
  }
}
