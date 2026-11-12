jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const readArticle = jest.fn();
jest.mock('@gitroom/nestjs-libraries/media/article.reader', () => ({
  ...jest.requireActual('@gitroom/nestjs-libraries/media/article.reader'),
  readArticle: (...a: unknown[]) => readArticle(...a),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn().mockResolvedValue('https://cdn.example/bg.png'), set: jest.fn() },
}));

import { MediaService } from './media.service';

// Studio "From a link": the article becomes the designer's brief.
const service = (credits: number) => {
  const s = Object.create(MediaService.prototype) as any;
  s.assertStorage = jest.fn();
  s._subscriptionService = { checkCredits: jest.fn().mockResolvedValue({ credits }) };
  s._brandKitService = { getNormalized: jest.fn().mockResolvedValue(null) };
  s._openAi = {
    generatePostCarousel: jest.fn().mockResolvedValue({
      imagePrompt: 'theme',
      colors: {},
      slides: [{ headline: 'a' }, { headline: 'b' }],
    }),
  };
  return s;
};
const dto = { platform: 'instagram-feed', slidesCount: 2, sourceUrl: 'https://blog.example/post' };
const org = { id: 'org1' } as any;
const billing = process.env.STRIPE_PUBLISHABLE_KEY;

beforeEach(() => {
  readArticle.mockReset().mockResolvedValue({ title: 'Launch week', text: 'Postra goes live on Monday.' });
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
});
afterAll(() => {
  if (billing === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
  else process.env.STRIPE_PUBLISHABLE_KEY = billing;
});

it('builds the carousel from the article, with the prompt as a note', async () => {
  const s = service(5);
  const out = await s.generatePostCarousel(org, { ...dto, prompt: 'for agencies' });
  expect(readArticle).toHaveBeenCalledWith('https://blog.example/post');
  const brief: string = s._openAi.generatePostCarousel.mock.calls[0][0];
  expect(brief).toContain('Title: Launch week');
  expect(brief).toContain('Postra goes live on Monday.');
  expect(brief).toContain('What the user asked for: for agencies');
  expect(out.slides).toHaveLength(2);
});

it('passes a plain prompt through untouched', async () => {
  const s = service(5);
  await s.generatePostCarousel(org, { platform: 'instagram-feed', slidesCount: 2, prompt: 'Summer sale' });
  expect(readArticle).not.toHaveBeenCalled();
  expect(s._openAi.generatePostCarousel.mock.calls[0][0]).toBe('Summer sale');
});

it('does not fetch anything for an account that is out of credits', async () => {
  const s = service(0);
  await expect(s.generatePostCarousel(org, dto)).rejects.toMatchObject({ status: 402 });
  expect(readArticle).not.toHaveBeenCalled();
});
