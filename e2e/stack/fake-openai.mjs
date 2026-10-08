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
//   POST /v1/responses          the Responses API the agent's model uses
//                               (@ai-sdk/openai): plain text, usage, also as
//                               a stream of response.* events
//   POST /v1/images/generations a 1x1 PNG as b64_json, like gpt-image; a
//                               prompt containing "stack-refuse" is refused
//                               the way the safety filter refuses
//   POST /__fail                the next completion answers 500
//   POST /__outage {"match": t, "on": bool}
//                               every /v1 call whose body contains t answers
//                               500 while on; each spec uses its own t, so
//                               specs running in parallel are unaffected
//
// It also stands in for kie.ai (stack.env: KIEAI_API_URL), the Veo video
// API, on the same port:
//   POST /api/v1/jobs/createTask  a task id; a prompt with "stack-kie-fail"
//                                 ends in state "fail", one with
//                                 "stack-kie-slow" reports "generating" on
//                                 its first poll
//   GET  /api/v1/jobs/recordInfo  the task's state; a finished clip is a
//                                 tiny MP4 as a data: URL (the app's
//                                 uploader refuses local http URLs)
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

// The smallest header that sniffs as video/mp4.
const MP4 = 'data:video/mp4;base64,AAAAGGZ0eXBpc29tAAACAGlzb21pc28ybXA0MQAAAAhmcmVl';
const kieTasks = new Map();

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

    if (req.method === 'POST' && req.url === '/v1/responses') {
      requests.push({ path: req.url, model: body.model, stream: !!body.stream });
      const created = Math.floor(Date.now() / 1000);
      const usage = {
        input_tokens: 11,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 7,
        output_tokens_details: { reasoning_tokens: 0 },
      };
      const message = { type: 'message', role: 'assistant', id: 'msg_stack' };
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const event = (data) => res.write(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
        event({ type: 'response.created', response: { id: 'resp_stack', created_at: created, model: body.model } });
        event({ type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } });
        event({ type: 'response.output_text.delta', item_id: 'msg_stack', delta: TEXT });
        event({
          type: 'response.output_item.done',
          output_index: 0,
          item: { ...message, content: [{ type: 'output_text', text: TEXT, annotations: [] }] },
        });
        event({ type: 'response.completed', response: { usage } });
        res.end();
        return;
      }
      return json(res, 200, {
        id: 'resp_stack',
        created_at: created,
        model: body.model,
        output: [{ ...message, content: [{ type: 'output_text', text: TEXT, annotations: [] }] }],
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

    if (req.method === 'POST' && req.url === '/api/v1/jobs/createTask') {
      requests.push({ path: req.url, model: body.model, input: body.input });
      if (req.headers.authorization !== `Bearer ${process.env.KIEAI_API_KEY || 'stack-fake-kie'}`) {
        return json(res, 200, { code: 401, msg: 'You do not have access permissions' });
      }
      const taskId = `stack-kie-${kieTasks.size + 1}-${Date.now()}`;
      const prompt = String(body.input?.prompt || '');
      kieTasks.set(taskId, {
        fail: prompt.includes('stack-kie-fail'),
        pending: prompt.includes('stack-kie-slow') ? 1 : 0,
      });
      return json(res, 200, { code: 200, msg: 'success', data: { taskId } });
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/v1/jobs/recordInfo?')) {
      const taskId = new URL(req.url, 'http://fake').searchParams.get('taskId');
      const task = kieTasks.get(taskId);
      if (!task) return json(res, 200, { code: 422, msg: 'recordInfo is null' });
      if (task.pending > 0) {
        task.pending--;
        return json(res, 200, { code: 200, data: { taskId, state: 'generating' } });
      }
      if (task.fail) {
        return json(res, 200, {
          code: 200,
          data: { taskId, state: 'fail', resultJson: '', failCode: '400', failMsg: 'stack: refused' },
        });
      }
      return json(res, 200, {
        code: 200,
        data: { taskId, state: 'success', resultJson: JSON.stringify({ resultUrls: [MP4] }) },
      });
    }

    json(res, 404, { error: { message: `fake openai: no route ${req.method} ${req.url}` } });
  });
}).listen(PORT, () => console.log(`fake openai on ${PORT}`));
