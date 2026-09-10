/**
 * Single source of truth for turning an org's Brand Kit into prompt text.
 *
 * The brand voice/style used to be assembled inline in four different places
 * (the agent persona, the design generator, the image tool, the inline caption
 * editor) which meant they could drift. These helpers centralise it so every AI
 * surface speaks in the same brand voice and reflects the same palette.
 *
 * `buildBrandContext` is the assembler; everything else is a preset over it.
 * Add a new AI surface by calling it with the parts that surface needs, never
 * by writing brand text inline again.
 */

export interface BrandPromptKit {
  colors?: { primary?: string; secondary?: string; text?: string };
  font?: string;
  tone?: string;
  logoPath?: string | null;
}

export interface BrandContextParts {
  /** Tone of voice — for anything that writes copy. */
  voice?: boolean;
  /** Colour direction — for anything that generates a picture. */
  palette?: boolean;
  /**
   * Keep the model from inventing a logo. The real one is composited onto
   * designs after generation (`design-render.service`), so a drawn-on
   * wordmark is always a second, wrong logo.
   */
  logoHint?: boolean;
}

const voiceLine = (kit?: BrandPromptKit | null): string =>
  kit?.tone ? `Brand tone of voice: ${kit.tone}. Write in that voice.` : '';

const paletteLine = (kit?: BrandPromptKit | null): string => {
  const primary = kit?.colors?.primary;
  const secondary = kit?.colors?.secondary;
  const bits: string[] = [];
  if (primary || secondary) {
    bits.push(
      `build the palette around ${[primary, secondary]
        .filter(Boolean)
        .join(' and ')}`
    );
  }
  if (kit?.tone) bits.push(`keep it consistent with a ${kit.tone} brand`);
  return bits.length ? `Visual brand style: ${bits.join(', ')}.` : '';
};

const logoLine = (kit?: BrandPromptKit | null): string =>
  kit?.logoPath
    ? 'Do not draw a logo, wordmark or brand name into the image — the brand logo is added to the design separately.'
    : '';

/** Compose exactly the brand guidance a surface needs, in one place. */
export function buildBrandContext(
  kit: BrandPromptKit | null | undefined,
  parts: BrandContextParts
): string {
  return [
    parts.voice && voiceLine(kit),
    parts.palette && paletteLine(kit),
    parts.logoHint && logoLine(kit),
  ]
    .filter(Boolean)
    .join(' ');
}

/** Voice guidance for COPY — captions, inline edits, agent post text. */
export function buildBrandVoicePrompt(kit?: BrandPromptKit | null): string {
  return buildBrandContext(kit, { voice: true });
}

/** Visual direction for IMAGE generation — palette, tone, hands off the logo. */
export function buildBrandImagePrompt(kit?: BrandPromptKit | null): string {
  return buildBrandContext(kit, { palette: true, logoHint: true });
}

/** Strict constraints for a full DESIGN spec — headline/colours/layout. */
export function buildBrandDesignPrompt(kit?: BrandPromptKit | null): string {
  if (!kit?.colors) return '';
  const c = kit.colors;
  return `BRAND CONSTRAINTS — respect strictly:
- Background color: ${c.secondary || 'designer choice'}
- Accent color: ${c.primary || 'designer choice'}
- Text color: ${c.text || '#ffffff'}
- Font family: ${kit.font || 'sans-serif'}
- Tone: ${kit.tone || 'professional'}`;
}

/**
 * Combined guidance for the conversational agent, which both writes copy and
 * generates visuals, so it needs voice + palette in one block.
 */
export function buildBrandAgentPrompt(kit?: BrandPromptKit | null): string {
  if (!kit) return '';
  return `
      Brand guidelines (apply these to everything you write and generate):
        - Tone of voice: ${kit.tone || 'not specified'}
        - Brand colors: primary ${kit.colors?.primary || '-'}, secondary ${
    kit.colors?.secondary || '-'
  }, text ${kit.colors?.text || '-'}
        - Brand font: ${kit.font || 'not specified'}
      Always write post copy in this tone of voice, and reflect these brand colors/style when you generate images or designs.
`;
}
