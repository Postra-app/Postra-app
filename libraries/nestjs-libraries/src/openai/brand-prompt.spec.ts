import {
  buildBrandContext,
  buildBrandVoicePrompt,
  buildBrandImagePrompt,
  buildBrandDesignPrompt,
  BrandPromptKit,
} from '@gitroom/nestjs-libraries/openai/brand-prompt';

const kit: BrandPromptKit = {
  colors: { primary: '#38bdf8', secondary: '#0a0e1a', text: '#ffffff' },
  font: 'Geist',
  tone: 'warm and direct',
  logoPath: 'logos/acme.png',
};

describe('buildBrandContext', () => {
  it('returns only the parts a surface asked for', () => {
    const voice = buildBrandContext(kit, { voice: true });
    expect(voice).toContain('warm and direct');
    expect(voice).not.toContain('#38bdf8');

    const palette = buildBrandContext(kit, { palette: true });
    expect(palette).toContain('#38bdf8');
    expect(palette).toContain('#0a0e1a');
    expect(palette).not.toContain('Write in that voice');
  });

  it('tells an image model to leave the logo alone, but only when there is one', () => {
    expect(buildBrandContext(kit, { logoHint: true })).toContain(
      'Do not draw a logo'
    );
    expect(
      buildBrandContext({ ...kit, logoPath: null }, { logoHint: true })
    ).toBe('');
  });

  it('is empty for an org with no kit, so prompts stay untouched', () => {
    expect(
      buildBrandContext(null, { voice: true, palette: true, logoHint: true })
    ).toBe('');
    expect(
      buildBrandContext({}, { voice: true, palette: true, logoHint: true })
    ).toBe('');
  });

  it('keeps a partial kit usable — colours without a tone still steer visuals', () => {
    const partial = buildBrandContext(
      { colors: { primary: '#38bdf8' } },
      { palette: true }
    );
    expect(partial).toContain('#38bdf8');
    expect(partial).not.toContain('undefined');
    expect(partial).not.toContain(' and .');
  });

  it('joins requested parts into one block', () => {
    const all = buildBrandContext(kit, {
      voice: true,
      palette: true,
      logoHint: true,
    });
    expect(all).toContain('warm and direct');
    expect(all).toContain('#38bdf8');
    expect(all).toContain('Do not draw a logo');
  });
});

describe('presets stay in step with the assembler', () => {
  it('voice preset is the voice part', () => {
    expect(buildBrandVoicePrompt(kit)).toBe(
      buildBrandContext(kit, { voice: true })
    );
  });

  it('image preset is palette plus the logo rule', () => {
    expect(buildBrandImagePrompt(kit)).toBe(
      buildBrandContext(kit, { palette: true, logoHint: true })
    );
  });

  it('design preset still emits the strict constraint block', () => {
    const design = buildBrandDesignPrompt(kit);
    expect(design).toContain('BRAND CONSTRAINTS');
    expect(design).toContain('#0a0e1a');
    expect(design).toContain('Geist');
    expect(buildBrandDesignPrompt(null)).toBe('');
  });
});
