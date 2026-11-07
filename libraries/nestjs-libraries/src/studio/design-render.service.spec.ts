import sharp from 'sharp';
import { DesignRenderService } from './design-render.service';
import { PostDesignSpec } from './post-design-spec';

const spec = (backgroundUrl: string): PostDesignSpec => ({
  headline: 'Plan a week of posts',
  subtext: 'Rendered on the server',
  cta: 'Try it',
  imagePrompt: '',
  colors: { background: '#0a0e1a', accent: '#38bdf8', text: '#ffffff' },
  layout: 'centered-stack',
  backgroundUrl,
  cacheHit: false,
  brandKit: null,
});

const size = async (png: Buffer) => {
  const { width, height, format } = await sharp(png).metadata();
  return { width, height, format };
};

describe('DesignRenderService', () => {
  const service = new DesignRenderService();

  // The gradient branch used to rasterise the SVG at density 96, which scaled
  // every draft without a background by 96/72.
  it('renders the gradient draft at exactly the requested size', async () => {
    const png = await service.renderDesignToPng(spec(''), {
      width: 1080,
      height: 1350,
    });
    expect(await size(png)).toEqual({
      width: 1080,
      height: 1350,
      format: 'png',
    });
  });

  it('renders over a background at exactly the requested size', async () => {
    const bg = await sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#1e293b' },
    })
      .png()
      .toBuffer();
    const png = await service.renderDesignToPng(
      spec(`data:image/png;base64,${bg.toString('base64')}`),
      { width: 1080, height: 1080 }
    );
    expect(await size(png)).toEqual({
      width: 1080,
      height: 1080,
      format: 'png',
    });
  });

  // The call to action was the accent colour straight on the picture, which
  // did not read on a dark or busy photo. It is a button now: accent fill,
  // black or white words, whichever reads on it.
  it('draws the call to action as a button in the accent colour', () => {
    const svg: string = (service as any).buildSvg(
      { ...spec(''), colors: { background: '#0a0e1a', accent: '#e11d48', text: '#ffffff' } },
      { width: 1080, height: 1350 },
      false
    );
    const button = svg.match(/<rect [^>]*fill="#e11d48"\/><text [^>]*fill="(#[0-9a-f]{6})"[^>]*>(.*?)<\/text>/);
    expect(button).not.toBeNull();
    expect(button![1]).toBe('#ffffff');
    expect(button![2]).toContain('Try it');
  });

  it('writes dark words on a light accent', () => {
    const svg: string = (service as any).buildSvg(
      { ...spec(''), colors: { background: '#0a0e1a', accent: '#fde047', text: '#ffffff' } },
      { width: 1080, height: 1350 },
      false
    );
    expect(svg).toMatch(/<rect [^>]*fill="#fde047"\/><text [^>]*fill="#000000"/);
  });
});
