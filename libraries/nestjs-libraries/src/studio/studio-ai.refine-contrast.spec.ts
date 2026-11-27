const parseChat = jest.fn();
jest.mock('@gitroom/nestjs-libraries/openai/parse-chat', () => ({ parseChat: (...a: unknown[]) => parseChat(...a) }));

import { StudioAiService } from './studio-ai.service';
import { contrastRatio, keepTextReadable, parseHex } from './studio-contrast';
import { applyPatch, StudioSpec } from './studio-spec';

// AI Refine "Stronger CTA" coloured the CTA text the red of the
// CTA bar (#d2143a on #d2143a), nearly unreadable.
const spec: StudioSpec = {
  version: 1,
  platform: 'instagram-square' as any,
  width: 1080,
  height: 1080,
  background: '#0a0e1a',
  layers: [
    { id: 'bar', kind: 'rect', x: 540, y: 900, originX: 'center', originY: 'center', width: 800, height: 140, fill: '#d2143a' } as any,
    { id: 'cta', kind: 'text', text: '20% off flat whites', x: 540, y: 900, originX: 'center', originY: 'center', width: 700, height: 80, fontFamily: 'Inter', fontSize: 56, color: '#ffffff' } as any,
    { id: 'title', kind: 'text', text: 'Winter coffee', x: 540, y: 200, originX: 'center', originY: 'center', width: 900, height: 120, fontFamily: 'Inter', fontSize: 96, color: '#ffffff' } as any,
  ],
};

const refine = (ops: unknown[]) => {
  parseChat.mockResolvedValue({ choices: [{ message: { parsed: { ops, explanation: 'Made the CTA stronger.' } } }] });
  const service = new (StudioAiService as any)();
  return service.refineSpec(spec, 'Stronger CTA');
};

describe('AI Refine keeps text readable', () => {
  beforeEach(() => parseChat.mockReset());

  it('the red-on-red CTA comes back readable', async () => {
    const { patch, nextSpec } = await refine([
      { op: 'update', id: 'cta', props: { color: '#d2143a', fontWeight: 'bold' } },
    ]);
    const cta = nextSpec.layers.find((l: any) => l.id === 'cta');
    expect(cta.color).toBe('#ffffff');
    expect(cta.fontWeight).toBe('bold');
    expect(patch.ops[0].props.color).toBe('#ffffff');
    expect(contrastRatio(parseHex(cta.color)!, parseHex('#d2143a')!)).toBeGreaterThanOrEqual(3);
  });

  it('a readable colour the model chose is kept', async () => {
    const { nextSpec } = await refine([{ op: 'update', id: 'cta', props: { color: '#fde047' } }]);
    expect(nextSpec.layers.find((l: any) => l.id === 'cta').color).toBe('#fde047');
  });

  it('text over the canvas is judged against the background', async () => {
    const { nextSpec } = await refine([{ op: 'update', id: 'title', props: { color: '#111827' } }]);
    expect(nextSpec.layers.find((l: any) => l.id === 'title').color).toBe('#ffffff');
  });

  it('the prompt asks for readable text', async () => {
    await refine([]);
    const system = parseChat.mock.calls[0][1].messages[0].content as string;
    expect(system).toMatch(/Text must stay readable/);
  });
});

describe('keepTextReadable', () => {
  it('judges a new text layer too, and leaves text over a photo alone', () => {
    const withPhoto: StudioSpec = {
      ...spec,
      layers: [{ id: 'photo', kind: 'image', src: 'x', x: 0, y: 0, originX: 'left', originY: 'top', width: 1080, height: 1080 } as any],
    };
    const add = { op: 'add', layer: { id: 'ai_1', kind: 'text', text: 'Hi', x: 540, y: 540, originX: 'center', originY: 'center', width: 100, height: 50, fontFamily: 'Inter', fontSize: 40, color: '#0a0e1a' } };
    expect(keepTextReadable(spec, { base: 3, ops: [add] } as any, applyPatch).fixed).toEqual(['ai_1']);
    expect(keepTextReadable(withPhoto, { base: 1, ops: [add] } as any, applyPatch).fixed).toEqual([]);
  });

  it('parses short and long hex, nothing else', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('#d2143a')).toEqual([210, 20, 58]);
    expect(parseHex('rgba(0,0,0,1)')).toBeNull();
  });
});
