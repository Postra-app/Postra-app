import { z } from 'zod';

// Structured outputs of the post Creator graph, kept apart from the service so
// a test can check them without booting the integrations.
export const category = z.object({
  category: z.string().describe('The category for the post'),
});

export const topic = z.object({
  topic: z.string().describe('The topic for the post'),
});

export const hook = z.object({
  hook: z
    .string()
    .describe(
      'Hook for the new post, don\'t take it from "the request of the user"'
    ),
});

export const contentZod = (
  isPicture: boolean,
  format: 'one_short' | 'one_long' | 'thread_short' | 'thread_long'
) => {
  const content = z.object({
    content: z.string().describe('Content for the new post'),
    // Nullable, never optional: OpenAI's strict schema needs every key in
    // `required`, and with zod 4 LangChain leaves an optional key out (400
    // "Missing 'website'", the post Creator failed on every run).
    website: z
      .string()
      .nullable()
      .describe(
        "Website for the new post if exists, If one of the post present a brand, website link must be to the root domain of the brand or don't include it, website url should contain the brand name"
      ),
    ...(isPicture
      ? {
          prompt: z
            .string()
            .describe(
              "Prompt to generate a picture for this post later, make sure it doesn't contain brand names and make it very descriptive in terms of style"
            ),
        }
      : {}),
  });

  return z.object({
    content:
      format === 'one_short' || format === 'one_long'
        ? content
        : z.array(content).min(2).describe(`Content for the new post`),
  });
};
