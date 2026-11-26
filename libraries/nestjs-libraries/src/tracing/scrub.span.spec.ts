import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import {
  ScrubbingSpanProcessor,
  scrubAttributes,
  scrubText,
  scrubUrl,
} from './scrub.span';

describe('scrubUrl', () => {
  it('keeps scheme, host and path', () => {
    expect(scrubUrl('https://graph.example.com/v19.0/me/media?access_token=abc&fields=id#top')).toBe(
      'https://graph.example.com/v19.0/me/media'
    );
    expect(scrubUrl('/posts/42?token=abc')).toBe('/posts/42');
    expect(scrubUrl('https://user:pass@api.example.com:8443/v1')).toBe('https://api.example.com:8443/v1');
  });

  it('replaces a path segment that reads as a key', () => {
    expect(scrubUrl('https://api.telegram.org/bot123456789:AAF-secret_bot_token_0123456789/sendMessage')).toBe(
      'https://api.telegram.org/[redacted]/sendMessage'
    );
    expect(scrubUrl('/public/preview/3f2b8c1e-7a4d-4e5f-9b6a-1c2d3e4f5a6b')).toBe('/public/preview/[redacted]');
    // Names and short identifiers stay readable.
    expect(scrubUrl('/integrations/social-connect/linkedin-page/12345')).toBe(
      '/integrations/social-connect/linkedin-page/12345'
    );
  });
});

describe('scrubText', () => {
  it('removes e-mail addresses, query strings and URL credentials from free text', () => {
    expect(scrubText('no user jane.doe+tag@mail.example.co.uk here')).toBe('no user [redacted] here');
    expect(scrubText('GET https://api.example.com/v1/me?token=abc failed')).toBe(
      'GET https://api.example.com/v1/me failed'
    );
    expect(scrubText('connect redis://:hunter2@cache:6379 refused')).toBe('connect redis://cache:6379 refused');
    expect(scrubText('to=jane%40example.com')).toBe('to=[redacted]');
  });
});

describe('scrubAttributes', () => {
  it('drops headers, bodies, query strings, statement parameters and client addresses', () => {
    expect(
      scrubAttributes({
        'http.request.header.authorization': ['Bearer abc'],
        'http.response.header.set-cookie': ['session=abc'],
        'http.request.body.content': '{"text":"a post"}',
        'url.query': 'token=abc',
        'db.query.parameter.0': 'jane@example.com',
        'db.redis.args': ['session:1', 'value'],
        'client.address': '203.0.113.77',
        'user_agent.original': 'Mozilla/5.0 (Macintosh)',
        'enduser.id': 'jane',
        'app.access_token': 'abc',
        'http.request.method': 'POST',
        'http.request.body.size': 120,
        'http.response.status_code': 200,
        'gen_ai.usage.input_tokens': 12,
      })
    ).toEqual({
      'http.request.method': 'POST',
      'http.request.body.size': 120,
      'http.response.status_code': 200,
      'gen_ai.usage.input_tokens': 12,
    });
  });

  it('drops the peer address of a request we served, and only of that', () => {
    const attributes = { 'network.peer.address': '203.0.113.77', 'network.peer.port': 50000, 'server.port': 3000 };
    expect(scrubAttributes(attributes, SpanKind.SERVER)).toEqual({ 'server.port': 3000 });
    expect(scrubAttributes(attributes, SpanKind.CLIENT)).toEqual(attributes);
  });

  it('cuts URLs down and takes literals out of SQL', () => {
    expect(
      scrubAttributes({
        'url.full': 'https://api.example.com/v1/me?access_token=abc',
        'http.target': '/posts?preview=abc',
        'db.query.text': `SELECT "id" FROM "User" WHERE "email" = 'jane@example.com' AND "name" = 'O''Neil' AND "org" = $1`,
        'http.route': '/posts/:id',
      })
    ).toEqual({
      'url.full': 'https://api.example.com/v1/me',
      'http.target': '/posts',
      'db.query.text': `SELECT "id" FROM "User" WHERE "email" = '?' AND "name" = '?' AND "org" = $1`,
      'http.route': '/posts/:id',
    });
  });
});

describe('ScrubbingSpanProcessor', () => {
  it('exports a scrubbed copy: name, attributes, status, events and links', async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new TracerProvider({
      spanProcessors: [new ScrubbingSpanProcessor(new SimpleSpanProcessor({ exporter }))],
    });
    const tracer = provider.getTracer('spec');
    const linked = tracer.startSpan('linked');
    const span = tracer.startSpan('GET /users/jane@example.com', {
      attributes: {
        'url.full': 'https://api.example.com/me?access_token=abc',
        'http.request.header.cookie': 'auth=abc',
      },
      links: [{ context: linked.spanContext(), attributes: { 'url.query': 'a=b', note: 'kept' } }],
    });
    span.recordException(new Error('no mailbox for jane@example.com'));
    span.setStatus({ code: SpanStatusCode.ERROR, message: 'no mailbox for jane@example.com' });
    span.end();
    await provider.forceFlush();

    const [sent] = exporter.getFinishedSpans();
    expect(sent.name).toBe('GET /users/[redacted]');
    expect(sent.attributes).toEqual({ 'url.full': 'https://api.example.com/me' });
    expect(sent.status).toEqual({ code: SpanStatusCode.ERROR, message: 'no mailbox for [redacted]' });
    expect(sent.events[0].attributes?.['exception.message']).toBe('no mailbox for [redacted]');
    expect(JSON.stringify(sent.events)).not.toContain('jane@example.com');
    expect(sent.links[0].attributes).toEqual({ note: 'kept' });
    // The rest of the span is the original's.
    expect(sent.spanContext()).toEqual(span.spanContext());
    expect(sent.ended).toBe(true);
    expect(sent.duration).toBeDefined();
    await provider.shutdown();
  });
});
