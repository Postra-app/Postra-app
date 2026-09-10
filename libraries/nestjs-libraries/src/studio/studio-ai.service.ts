import { HttpException, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { parseChat } from '@gitroom/nestjs-libraries/openai/parse-chat';
import { recordAiUsage } from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { buildBrandVoicePrompt } from '@gitroom/nestjs-libraries/openai/brand-prompt';

import {
  StudioBrandRef,
  StudioPatch,
  StudioPatchOp,
  StudioSpec,
  applyPatch,
  validatePatchAgainstSpec,
} from './studio-spec';

/**
 * The two languages the composer offers. Mapped here rather than passed
 * through, so the prompt only ever names a language we chose.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  pl: 'Polish',
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
  // Cap per-request time (SDK default is 10 min) so a stuck OpenAI call can't
  // pin a request/worker under load. 90s comfortably covers vision + text ops.
  // maxRetries stays at the SDK default (2, backoff on 429/5xx).
  timeout: 90_000,
});

const ORIGIN = z.enum(['left', 'center', 'right', 'top', 'bottom']);

// OpenAI strict structured outputs require EVERY field to be required, so an
// optional field MUST also be `.nullable()` (the API rejects bare `.optional()`
// at zodResponseFormat conversion → 500 on refine/variants/decompose). Keep
// `.optional().nullable()` on all non-mandatory layer fields.
const TextLayerSchema = z.object({
  id: z.string(),
  kind: z.literal('text'),
  slot: z.string().optional().nullable(),
  x: z.number(),
  y: z.number(),
  originX: ORIGIN,
  originY: ORIGIN,
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.union([z.string(), z.number()]).optional().nullable(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional().nullable(),
  color: z.string(),
  lineHeight: z.number().optional().nullable(),
  charSpacing: z.number().optional().nullable(),
});

const ShapeLayerSchema = z.object({
  id: z.string(),
  kind: z.enum(['rect', 'circle', 'triangle', 'polygon', 'path', 'line']),
  slot: z.string().optional().nullable(),
  x: z.number(),
  y: z.number(),
  originX: ORIGIN,
  originY: ORIGIN,
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  // Without opacity on add, a tint overlay (the only way AI can "recolor" a
  // photo) would render fully opaque and bury the image.
  opacity: z.number().optional().nullable(),
  fill: z.string().optional().nullable(),
  stroke: z.string().optional().nullable(),
  strokeWidth: z.number().optional().nullable(),
  rx: z.number().optional().nullable(),
  ry: z.number().optional().nullable(),
  radius: z.number().optional().nullable(),
  path: z.string().optional().nullable(),
});

const ImageLayerSchema = z.object({
  id: z.string(),
  kind: z.literal('image'),
  slot: z.string().optional().nullable(),
  x: z.number(),
  y: z.number(),
  originX: ORIGIN,
  originY: ORIGIN,
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  src: z.string(),
});

const LayerSchema = z.discriminatedUnion('kind', [
  TextLayerSchema,
  ShapeLayerSchema,
  ImageLayerSchema,
]);

// Concrete updatable-fields schema. OpenAI strict structured outputs reject
// z.record (dynamic keys → no fixed `properties`/`additionalProperties:false`),
// which 400'd the whole refine call. List the layer fields the model may patch;
// all optional().nullable() per the strict "every field required" rule. Null
// values are skipped when applied (applyUpdateToFabric ignores null/undefined).
const PatchPropsSchema = z.object({
  text: z.string().optional().nullable(),
  color: z.string().optional().nullable(),
  fill: z.string().optional().nullable(),
  stroke: z.string().optional().nullable(),
  strokeWidth: z.number().optional().nullable(),
  fontFamily: z.string().optional().nullable(),
  fontSize: z.number().optional().nullable(),
  fontWeight: z.union([z.string(), z.number()]).optional().nullable(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional().nullable(),
  x: z.number().optional().nullable(),
  y: z.number().optional().nullable(),
  width: z.number().optional().nullable(),
  height: z.number().optional().nullable(),
  rotation: z.number().optional().nullable(),
  opacity: z.number().optional().nullable(),
  radius: z.number().optional().nullable(),
  rx: z.number().optional().nullable(),
  ry: z.number().optional().nullable(),
  lineHeight: z.number().optional().nullable(),
  charSpacing: z.number().optional().nullable(),
});

const PatchOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), layer: LayerSchema }),
  z.object({
    op: z.literal('update'),
    id: z.string(),
    props: PatchPropsSchema,
  }),
  z.object({ op: z.literal('delete'), id: z.string() }),
  z.object({ op: z.literal('reorder'), ids: z.array(z.string()) }),
]);

const RefinePatchSchema = z.object({
  ops: z.array(PatchOpSchema).max(20),
  explanation: z.string().max(200),
});

const VoiceCheckSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.string().max(280),
  tags: z.array(z.string()).max(4),
});

export interface BrandVoiceInput {
  caption: string;
  recentPosts: string[];
  brand?: StudioBrandRef;
}

export interface BrandVoiceResult {
  score: number;
  feedback: string;
  tags: string[];
}

export interface SemanticSearchResult {
  id: string;
  score: number;
}

const MODEL_GPT = 'gpt-4.1';
const MODEL_VISION = 'gpt-4o';
const MODEL_EMBED = 'text-embedding-3-small';

@Injectable()
export class StudioAiService {
  /**
   * Patch an existing spec instead of replacing it. AI returns a small ops
   * list (add / update / delete / reorder) which we validate against the
   * current spec before applying — that rejects hallucinated layer ids.
   */
  async refineSpec(
    spec: StudioSpec,
    instruction: string,
    screenshotDataUrl?: string,
    orgId?: string
  ): Promise<{ patch: StudioPatch; nextSpec: StudioSpec; explanation: string }> {
    // The client sends the whole spec, which we inline into the prompt. Bound
    // it server-side (same 200-layer cap the patch validator enforces) so a
    // 25mb body of layers can't be repeatedly turned into OpenAI token cost.
    if (!Array.isArray(spec?.layers) || spec.layers.length > 200) {
      throw new HttpException('Design spec too large to refine', 400);
    }

    const system = `You edit social-media post designs by emitting JSON patch ops on a StudioSpec.

Rules:
- Only emit ops that reference layer ids that already exist in the spec (for update/delete).
- New layers (op:add) need a fresh id starting with "ai_".
- Preserve user intent. If they ask "shorter headline", only update the text layer's text.
- Keep all coordinates inside canvas bounds (0..width / 0..height).
- Use the brand colors in the spec when changing fills or text colors.
- Image layers are photos: you CANNOT recolor, retouch or edit their pixels. Setting fill/color on an image layer does nothing — never do it, and never claim you changed a photo.
- To make the picture warmer/cooler/tinted/darker: ADD a full-canvas rect (x:0, y:0, originX:left, originY:top, width/height = canvas size) with the tint color as fill and opacity 0.15-0.35 — added layers render on top, so it tints the photo. Say in the explanation that you added a colour tint overlay.
- If the request truly needs photo editing (add/remove objects or people, change the scene), emit no ops and point at the in-app paths instead of external tools: (1) the Images tool's stock search — name the exact term to search (e.g. "scarecrow") so they can drop it onto the design as its own layer; (2) regenerating in AI Generate with the change added to the prompt. Never send the user to outside photo editors.
- Reply in the same language as the instruction (Polish or English).`;

    const userText = [
      `Canvas: ${spec.width}x${spec.height} (${spec.platform}).`,
      `Brand: ${JSON.stringify(spec.brand ?? null)}.`,
      `Spec layers:`,
      JSON.stringify(spec.layers, null, 0),
      ``,
      `Instruction: ${instruction}`,
    ].join('\n');

    const callModel = async (useImage: boolean) => {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: system },
        useImage && screenshotDataUrl
          ? {
              role: 'user',
              content: [
                { type: 'text', text: userText },
                { type: 'image_url', image_url: { url: screenshotDataUrl } },
              ],
            }
          : { role: 'user', content: userText },
      ];
      return (
        await parseChat(openai, {
          model: useImage ? MODEL_VISION : MODEL_GPT,
          messages,
          response_format: zodResponseFormat(RefinePatchSchema, 'refinePatch'),
        }, { organizationId: orgId ?? null, engine: 'studio' })
      ).choices[0].message.parsed;
    };

    // Vision (gpt-4o) gives visual context but intermittently returns an
    // empty/refusal response for structured outputs (→ "no patch"). Fall back
    // to reliable text-only gpt-4.1 — the spec JSON already carries every
    // layer's text/colors/positions, which is enough for most edits.
    let parsed = await callModel(!!screenshotDataUrl);
    if (!parsed && screenshotDataUrl) {
      parsed = await callModel(false);
    }

    if (!parsed) throw new Error('AI returned no patch');

    const patch: StudioPatch = { base: spec.layers.length, ops: parsed.ops as StudioPatchOp[] };
    const validation = validatePatchAgainstSpec(spec, patch);
    if (validation.ok === false) {
      throw new Error(`Patch rejected: ${validation.reason}`);
    }

    return { patch, nextSpec: applyPatch(spec, patch), explanation: parsed.explanation };
  }


  /**
   * Score a caption against the user's recent posts + brand tone. Used in
   * the composer as a soft signal (ribbon). Cheap: text-only GPT-4.1 call.
   */
  async checkBrandVoice(
    input: BrandVoiceInput,
    orgId?: string
  ): Promise<BrandVoiceResult> {
    const samples = input.recentPosts.slice(0, 5).filter(Boolean);
    const tone = input.brand?.tone || 'professional';

    const system = `You evaluate whether a draft social media caption matches the author's existing brand voice.

Score 0-100 where:
- 100: perfectly matches tone, vocabulary, and energy of recent posts
- 60-80: mostly on brand, minor adjustments would help
- 30-60: some clashes (wrong register, formality, emoji density)
- 0-30: completely off-brand

Reply in the language of the draft.
Return concise feedback (2 short sentences, actionable). Tags = up to 4 short labels (e.g. "too formal", "missing CTA").`;

    const userText = [
      `Brand tone declared: ${tone}.`,
      samples.length
        ? `Recent posts (newest first):\n${samples.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : 'No recent posts available — rely on declared tone.',
      ``,
      `Draft caption:\n${input.caption}`,
    ].join('\n');

    const parsed = (
      await parseChat(openai, {
        model: MODEL_GPT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userText },
        ],
        response_format: zodResponseFormat(VoiceCheckSchema, 'voiceCheck'),
      }, { organizationId: orgId ?? null, engine: 'studio' })
    ).choices[0].message.parsed;

    if (!parsed) throw new Error('AI returned no voice check');
    return {
      score: parsed.score,
      feedback: parsed.feedback,
      tags: parsed.tags ?? [],
    };
  }

  /**
   * Rewrite a post caption inline in the composer — improve, shorten, expand,
   * adapt to a platform, or fix the tone — in the user's brand voice.
   */
  /**
   * Hashtags for one post on one platform. Every scheduler in this price band
   * ships this; we shipped none. Kept deliberately small: no invented brand
   * names, no banned-on-Instagram tags, and a count that matches what the
   * platform actually rewards.
   */
  /**
   * One line of alt text for an image. Four of the schedulers we compared ship
   * this and we shipped none, and the field has been sitting in media settings
   * with nothing to fill it.
   */
  async describeImageForAlt(
    imageUrl: string,
    orgId?: string
  ): Promise<{ alt: string }> {
    const AltSchema = z.object({ alt: z.string() });

    const system = `You write alt text for an image attached to a social media post.
Rules:
- One sentence, at most 125 characters.
- Describe what is actually visible: subject, action, setting. Nothing you cannot see.
- No "image of", "picture of", "photo showing" — screen readers already say that.
- Read any prominent text in the image out loud as part of the sentence.
- Plain, neutral language. No marketing, no hashtags, no emoji.`;

    const parsed = (
      await parseChat(openai, {
        model: MODEL_VISION,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: imageUrl } },
            ] as never,
          },
        ],
        response_format: zodResponseFormat(AltSchema, 'describeImageForAlt'),
      }, { organizationId: orgId ?? null, engine: 'studio' })
    ).choices[0].message.parsed;

    if (!parsed) throw new Error('AI returned no alt text');
    return { alt: parsed.alt.trim().slice(0, 125) };
  }

  async suggestHashtags(
    input: { text: string; platform?: string; tone?: string },
    orgId?: string
  ): Promise<{ hashtags: string[] }> {
    const HashtagSchema = z.object({ hashtags: z.array(z.string()) });

    // What each platform actually rewards, rather than one number for all.
    const perPlatform: Record<string, string> = {
      instagram: '8-12 tags, a mix of broad reach and niche',
      'instagram-standalone': '8-12 tags, a mix of broad reach and niche',
      threads: '2-3 tags at most',
      x: '1-2 tags at most',
      linkedin: '3-5 professional tags',
      'linkedin-page': '3-5 professional tags',
      facebook: '2-4 tags',
      tiktok: '4-6 tags, including one or two trend-style tags',
      youtube: '4-6 tags',
      pinterest: '4-8 descriptive tags',
      mastodon: '3-5 tags — they are how discovery works there',
      bluesky: '2-3 tags',
    };
    const guidance =
      perPlatform[(input.platform || '').toLowerCase()] ?? '5-8 tags';

    const system = `You suggest hashtags for a social media post.
${buildBrandVoicePrompt({ tone: input.tone })}
Rules:
- ${guidance}.
- Order them most relevant first.
- Each tag starts with # and contains no spaces or punctuation.
- Match the language of the post.
- Describe what the post is actually about. No invented brand or product names, no generic filler (#love #instagood #follow4follow), nothing misleading.
- Do not repeat a hashtag that already appears in the post.
- Return the tags only, no commentary.`;

    const parsed = (
      await parseChat(openai, {
        model: MODEL_GPT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: input.text },
        ],
        response_format: zodResponseFormat(HashtagSchema, 'suggestHashtags'),
      }, { organizationId: orgId ?? null, engine: 'studio' })
    ).choices[0].message.parsed;

    if (!parsed) throw new Error('AI returned no hashtags');

    // The model is asked for clean tags; normalise anyway so the UI never has
    // to think about it.
    const seen = new Set<string>();
    const hashtags = (parsed.hashtags as string[])
      .map((tag: string) => '#' + tag.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, ''))
      .filter((tag: string) => {
        const key = tag.toLowerCase();
        if (tag.length < 2 || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 15);

    return { hashtags };
  }

  async editText(
    input: {
      text: string;
      action: string;
      platform?: string;
      tone?: string;
      language?: string;
    },
    orgId?: string
  ): Promise<{ text: string }> {
    const EditSchema = z.object({ text: z.string() });

    const instructions: Record<string, string> = {
      improve:
        'Rewrite it to be clearer, more engaging and more likely to perform well on social media, keeping the same core meaning.',
      shorten:
        'Make it noticeably shorter and punchier without losing the core message.',
      expand: 'Add a little more detail and value while staying on topic.',
      adapt: `Adapt it to fit ${
        input.platform || 'this platform'
      }'s style, length and conventions.`,
      fix_tone:
        'Rewrite it so it better matches the declared brand tone of voice.',
      translate: `Translate it into ${
        LANGUAGE_NAMES[input.language ?? ''] || 'English'
      }. Translate the wording, not the brand: keep names, @mentions, #hashtags, links, numbers and emoji exactly as they are, and keep the line breaks.`,
    };

    const system = `You are an expert social media copywriter. Rewrite the user's post caption. ${
      instructions[input.action] || instructions.improve
    }
${buildBrandVoicePrompt({ tone: input.tone })}
${
  input.action === 'translate'
    ? 'Write the result in the target language named above, whatever language the input is in.'
    : 'Keep the SAME language as the input.'
} Preserve important facts, @mentions, #hashtags and links. Return ONLY the rewritten caption as plain text — no surrounding quotes, no explanation, no markdown or HTML.`;

    const parsed = (
      await parseChat(openai, {
        model: MODEL_GPT,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: input.text },
        ],
        response_format: zodResponseFormat(EditSchema, 'editText'),
      }, { organizationId: orgId ?? null, engine: 'studio' })
    ).choices[0].message.parsed;

    if (!parsed) throw new Error('AI returned no edited text');
    return { text: parsed.text };
  }

  // Embeddings are cheap per call but template search runs on every keystroke
  // pause in Studio, so they belong in the usage log like everything else.
  // They were the second blind spot next to images.
  async embedText(text: string, orgId?: string | null): Promise<number[]> {
    const trimmed = text.trim().slice(0, 8000);
    const res = await openai.embeddings.create({
      model: MODEL_EMBED,
      input: trimmed,
    });
    recordAiUsage({
      organizationId: orgId ?? null,
      engine: 'media',
      model: MODEL_EMBED,
      inputAmount: res.usage?.prompt_tokens ?? 0,
    });
    return res.data[0].embedding;
  }

  async embedBatch(
    texts: string[],
    orgId?: string | null
  ): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await openai.embeddings.create({
      model: MODEL_EMBED,
      input: texts.map((t) => t.trim().slice(0, 8000)),
    });
    recordAiUsage({
      organizationId: orgId ?? null,
      engine: 'media',
      model: MODEL_EMBED,
      inputAmount: res.usage?.prompt_tokens ?? 0,
    });
    return res.data.map((d) => d.embedding);
  }
}

export const cosineSimilarity = (a: number[], b: number[]): number => {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
};

export const rankBySimilarity = (
  queryEmbedding: number[],
  candidates: { id: string; embedding: number[] }[]
): SemanticSearchResult[] => {
  return candidates
    .map((c) => ({ id: c.id, score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b.score - a.score);
};
