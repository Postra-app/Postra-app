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
});
