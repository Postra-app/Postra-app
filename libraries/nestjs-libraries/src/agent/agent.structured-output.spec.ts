import { ChatOpenAI } from '@langchain/openai';
import { category, contentZod, hook, topic } from './agent.schemas';

// OpenAI's strict structured outputs reject a schema whose object leaves any
// property out of `required`. After zod 4 (app #415) LangChain dropped the
// `.nullable().optional()` website from `required` and the post Creator
// failed on every run with 400 "Missing 'website'" (Sentry POSTRA-1J,
// canary 2026-10-26). The request is captured as LangChain really sends it.
const sentSchema = async (schema: Parameters<ChatOpenAI['withStructuredOutput']>[0]) => {
  let body: any;
  const model = new ChatOpenAI({
    apiKey: 'sk-test',
    model: 'gpt-4.1',
    maxRetries: 0,
    configuration: {
      fetch: async (_url: any, init: any) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ error: { message: 'stop' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      },
    },
  });
  await model
    .withStructuredOutput(schema)
    .invoke('x')
    .catch(() => undefined);
  return body.response_format.json_schema;
};

const objectsMissingRequired = (node: any, path = '$'): string[] => {
  if (!node || typeof node !== 'object') return [];
  const own =
    node.type === 'object' && node.properties
      ? Object.keys(node.properties)
          .filter((key) => !(node.required || []).includes(key))
          .map((key) => `${path}.${key}`)
      : [];
  return [
    ...own,
    ...Object.entries(node).flatMap(([key, value]) =>
      objectsMissingRequired(value, `${path}.${key}`)
    ),
  ];
};

describe('post Creator structured output', () => {
  for (const [name, schema] of Object.entries({ category, topic, hook })) {
    it(`${name}: every key is required`, async () => {
      expect(objectsMissingRequired((await sentSchema(schema)).schema)).toEqual([]);
    });
  }
  for (const format of ['one_short', 'one_long', 'thread_short', 'thread_long'] as const) {
    for (const isPicture of [false, true]) {
      it(`${format}${isPicture ? ' with a picture' : ''}: every key is required, as strict mode demands`, async () => {
        const jsonSchema = await sentSchema(contentZod(isPicture, format));
        expect(jsonSchema.strict).toBe(true);
        expect(objectsMissingRequired(jsonSchema.schema)).toEqual([]);
      });
    }
  }
});
