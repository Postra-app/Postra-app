import {
  SpanKind,
  type Attributes,
  type AttributeValue,
  type Context,
} from '@opentelemetry/api';
import type {
  ReadableSpan,
  Span,
  SpanProcessor,
} from '@opentelemetry/sdk-trace';

// Traces leave the process, so they carry timings and names only: no
// credentials, no content a person wrote and nothing that identifies one.
// The instrumentations are configured not to collect such data in the first
// place (initialize.tracing.ts); this is the last step before export and
// removes what a library, or a later version of one, records anyway.

const REDACTED = '[redacted]';

// Attribute names that hold headers, bodies, query strings, statement
// parameters or a client's address, in the current and the older semantic
// conventions.
const DROPPED_KEYS: RegExp[] = [
  /^http\.(request|response)\.header\./,
  /^http\.(request|response)\.body(?!\.size$)/,
  /^(url|http)\.query$/,
  /^url\.fragment$/,
  /^db\.(query|operation)\.parameter/,
  /^db\.statement\.(parameters|values)/,
  /^db\.redis\.(args|arguments)/,
  /^(client|http\.client|net\.sock\.peer)\.(address|ip|addr)$/,
  /^http\.client_ip$/,
  /^(user_agent\.|http\.user_agent$)/,
  /^(enduser|user)\./,
  /(^|[._-])(authorization|cookie|password|passwd|secret|token|api[-_.]?key|session[-_.]?id)([._-]|$)/i,
];

// On a request we serve, the peer is the caller: a person's IP address when
// no proxy stands in between.
const DROPPED_SERVER_KEYS = /^(network\.peer|net\.peer|net\.sock\.peer)\./;

const EMAIL = /[A-Z0-9._%+-]+(@|%40)[A-Z0-9-]+(\.[A-Z0-9-]+)*\.[A-Z]{2,}/gi;

// A URL inside any text, up to its query string or fragment.
const URL_WITH_QUERY = /\b([a-z][a-z0-9+.-]*:\/\/[^\s?#'"<>]*)[?#][^\s'"<>]*/gi;
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@'"<>]*@/gi;

// Attributes whose whole value is a URL or a request target.
const URL_KEYS = new Set(['url.full', 'http.url', 'url.path', 'http.target']);

// Attributes that hold SQL. Prisma sends values as bind parameters, which are
// not part of the text; a literal written into a raw query is.
const SQL_KEYS = new Set(['db.query.text', 'db.statement']);
const SQL_STRING_LITERAL = /'(?:[^']|'')*'/g;

// A path segment that reads as a key rather than a name: long, with digits
// among letters. Some APIs put the credential in the path (a bot token, a
// webhook secret), and identifiers of this shape say nothing about timing.
const SECRET_SEGMENT = /^(?=.*\d)(?=.*[A-Za-z])[A-Za-z0-9._~:%+=-]{20,}$/;

const scrubPath = (path: string) =>
  path
    .split('/')
    .map((segment) => (SECRET_SEGMENT.test(segment) ? REDACTED : segment))
    .join('/');

/** Scheme, host and path of a URL or request target; nothing after `?` or `#`. */
export const scrubUrl = (value: string): string => {
  const end = value.search(/[?#]/);
  const withoutQuery = end === -1 ? value : value.slice(0, end);
  const match = /^([a-z][a-z0-9+.-]*:\/\/)([^/]*)(.*)$/i.exec(withoutQuery);
  if (!match) {
    return scrubPath(withoutQuery);
  }
  const [, scheme, authority, path] = match;
  return scheme + authority.slice(authority.lastIndexOf('@') + 1) + scrubPath(path);
};

/** Free text (a span name, an error message): no e-mail addresses, no query strings. */
export const scrubText = (value: string): string =>
  value
    .replace(URL_CREDENTIALS, '$1')
    .replace(URL_WITH_QUERY, '$1')
    .replace(EMAIL, REDACTED);

const scrubValue = (key: string, value: AttributeValue): AttributeValue => {
  if (typeof value === 'string') {
    if (URL_KEYS.has(key)) {
      return scrubText(scrubUrl(value));
    }
    if (SQL_KEYS.has(key)) {
      return scrubText(value.replace(SQL_STRING_LITERAL, "'?'"));
    }
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      typeof item === 'string' ? scrubText(item) : item
    ) as AttributeValue;
  }
  return value;
};

export const scrubAttributes = (
  attributes: Attributes,
  kind?: SpanKind
): Attributes => {
  const clean: Attributes = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (
      value === undefined ||
      DROPPED_KEYS.some((dropped) => dropped.test(key)) ||
      (kind === SpanKind.SERVER && DROPPED_SERVER_KEYS.test(key))
    ) {
      continue;
    }
    clean[key] = scrubValue(key, value);
  }
  return clean;
};

/** A copy of the finished span that is safe to export; the span itself is left alone. */
export const scrubSpan = (span: ReadableSpan): ReadableSpan => {
  const overrides: Partial<ReadableSpan> = {
    name: scrubText(span.name),
    attributes: scrubAttributes(span.attributes, span.kind),
    status: span.status.message
      ? { ...span.status, message: scrubText(span.status.message) }
      : span.status,
    events: span.events.map((event) => ({
      ...event,
      name: scrubText(event.name),
      attributes: event.attributes && scrubAttributes(event.attributes),
    })),
    links: span.links.map((link) => ({
      ...link,
      attributes: link.attributes && scrubAttributes(link.attributes),
    })),
  };
  // The prototype keeps everything else (ids, times, resource) as it is,
  // including the members that are getters on the SDK's span.
  return Object.create(
    span,
    Object.fromEntries(
      Object.entries(overrides).map(([key, value]) => [
        key,
        { value, enumerable: true },
      ])
    )
  );
};

/** Hands every finished span to the next processor scrubbed. */
export class ScrubbingSpanProcessor implements SpanProcessor {
  constructor(private readonly next: SpanProcessor) {}

  onStart(span: Span, parentContext: Context): void {
    this.next.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    this.next.onEnd(scrubSpan(span));
  }

  forceFlush(): Promise<void> {
    return this.next.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.next.shutdown();
  }
}
