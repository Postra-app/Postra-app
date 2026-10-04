// A stand-in OpenAI for the stack tests: stack.env points OPENAI_BASE_URL
// here, and the official SDK reads it, so the app's AI code runs unchanged
// and costs nothing.
//
//   POST /v1/chat/completions   answers with JSON that fits the request's
//                               json_schema (structured outputs), or plain
//                               text; usage as OpenAI reports it (streams
//                               only with stream_options.include_usage)
//   GET  /__requests            every request received so far
//   GET  /__seen?text=t         how many /v1 requests carried t in their
//                               body — a spec counts its own calls by a
//                               unique marker while others run in parallel
//   POST /v1/images/generations a 1x1 PNG as b64_json, like gpt-image; a
//                               prompt containing "stack-refuse" is refused
//                               the way the safety filter refuses
//   POST /__fail                the next completion answers 500
//   POST /__outage {"match": t, "on": bool}
//                               every /v1 call whose body contains t answers
//                               500 while on; each spec uses its own t, so
//                               specs running in parallel are unaffected
import { createServer } from 'node:http';

const PORT = Number(process.env.FAKE_OPENAI_PORT || 58090);
export const TEXT = 'Stack AI answer.';
const requests = [];
// Raw /v1 bodies, for /__seen.
const bodies = [];
let failNext = false;
const outages = new Set();

// The smallest value that satisfies a JSON schema — enough for the app to
// parse a structured output the way it parses OpenAI's.
const instanceOf = (schema, defs = schema?.$defs ?? schema?.definitions ?? {}) => {
  if (!schema) return null;
  if (schema.$ref) return instanceOf(defs[schema.$ref.split('/').pop()], defs);
  if (schema.enum) return schema.enum[0];
  if (schema.const !== undefined) return schema.const;
  if (schema.anyOf) return instanceOf(schema.anyOf.find((s) => s.type !== 'null') ?? schema.anyOf[0], defs);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        out[key] = instanceOf(value, defs);
      }
      return out;
    }
    case 'array':
      return [instanceOf(schema.items, defs)];
    case 'string':
      return TEXT;
    case 'number':
    case 'integer':
      return 1;
    case 'boolean':
      return true;
    default:
      return null;
  }
};

// A valid 1x1 PNG, so the upload path (type sniffing, sharp) runs for real.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }

    if (req.method === 'GET' && req.url === '/health') return json(res, 200, { ok: true });
    if (req.method === 'GET' && req.url === '/__requests') return json(res, 200, requests);
    if (req.method === 'POST' && req.url === '/__fail') {
      failNext = true;
      return json(res, 200, { failNext });
    }
    if (req.method === 'POST' && req.url === '/__outage') {
      if (body.on) outages.add(body.match);
      else outages.delete(body.match);
      return json(res, 200, { outages: [...outages] });
    }
    if (req.method === 'GET' && req.url?.startsWith('/__seen?')) {
      const text = new URL(req.url, 'http://fake').searchParams.get('text') || '';
      return json(res, 200, { count: text ? bodies.filter((b) => b.includes(text)).length : 0 });
    }
    if (req.url?.startsWith('/v1/')) bodies.push(raw);
    if (req.url?.startsWith('/v1/') && [...outages].some((t) => raw.includes(t))) {
      requests.push({ path: req.url, model: body.model, outage: true });
      return json(res, 500, { error: { message: 'The server had an error', type: 'server_error' } });
    }

    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      requests.push({
        path: req.url,
        model: body.model,
        stream: !!body.stream,
        includeUsage: !!body.stream_options?.include_usage,
      });
      if (failNext) {
        failNext = false;
        return json(res, 500, { error: { message: 'The server had an error', type: 'server_error' } });
      }
      const schema = body.response_format?.json_schema?.schema;
      const content = schema ? JSON.stringify(instanceOf(schema)) : TEXT;
      const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };

      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const chunk = (delta, finish = null, extra = {}) =>
          `data: ${JSON.stringify({
            id: 'chatcmpl-stack',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: body.model,
            choices: [{ index: 0, delta, finish_reason: finish }],
            ...extra,
          })}\n\n`;
        res.write(chunk({ role: 'assistant', content }));
        res.write(chunk({}, 'stop'));
        // Like OpenAI: a stream reports usage only when asked to, in a last
        // chunk with no choices. Code that forgets to ask meters nothing.
        if (body.stream_options?.include_usage) {
          res.write(chunk({}, null, { choices: [], usage }));
        }
        res.end('data: [DONE]\n\n');
        return;
      }

      return json(res, 200, {
        id: 'chatcmpl-stack',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content, refusal: null },
            finish_reason: 'stop',
          },
        ],
        usage,
      });
    }

    if (req.method === 'POST' && req.url === '/v1/images/generations') {
      requests.push({ path: req.url, model: body.model, size: body.size });
      if (String(body.prompt || '').includes('stack-refuse')) {
        return json(res, 400, {
          error: {
            message: 'Your request was rejected as a result of our safety system.',
            type: 'image_generation_user_error',
            code: 'moderation_blocked',
          },
        });
      }
      return json(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{ b64_json: PNG_1x1 }],
        usage: { input_tokens: 9, output_tokens: 1056, total_tokens: 1065 },
      });
    }

    json(res, 404, { error: { message: `fake openai: no route ${req.method} ${req.url}` } });
  });
}).listen(PORT, () => console.log(`fake openai on ${PORT}`));
