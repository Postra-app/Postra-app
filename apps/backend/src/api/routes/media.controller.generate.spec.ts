// The controller module pulls isomorphic-dompurify and nostr-tools through its
// DTO and provider imports; neither starts in jest here and neither matters.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { HttpException } from '@nestjs/common';
import { MediaController } from './media.controller';

const org = { id: 'org-1' } as any;

const controllerWith = (credits: number, generated: string | null) => {
  const media = {
    generateImage: jest.fn().mockResolvedValue(generated),
    saveFile: jest.fn().mockResolvedValue({ id: 'm1', path: generated }),
  };
  const subscription = {
    checkCredits: jest.fn().mockResolvedValue({ credits }),
  };
  const controller = new MediaController(
    media as any,
    subscription as any,
    {} as any
  );
  return { controller, media };
};

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : String(e);
  }
};

describe('image generation answers (E2E-02-16)', () => {
  const env = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
  });
  afterAll(() => {
    process.env.STRIPE_PUBLISHABLE_KEY = env;
  });

  it('out of credits is 402 on both routes, and nothing is generated', async () => {
    const { controller, media } = controllerWith(0, 'https://cdn/x.png');
    expect(
      await statusOf(controller.generateImageFromText(org, 'a cat'))
    ).toBe(402);
    expect(
      await statusOf(controller.generateImage(org, {} as any, 'a cat'))
    ).toBe(402);
    expect(media.generateImage).not.toHaveBeenCalled();
  });

  it('a model that returns no image is 502, never 201 with false', async () => {
    const { controller } = controllerWith(5, null);
    expect(
      await statusOf(controller.generateImageFromText(org, 'a cat'))
    ).toBe(502);
    expect(
      await statusOf(controller.generateImage(org, {} as any, 'a cat'))
    ).toBe(502);
  });

  it('a generated image is saved and returned', async () => {
    const { controller, media } = controllerWith(5, 'https://cdn/x.png');
    await expect(
      controller.generateImageFromText(org, 'a cat')
    ).resolves.toEqual({ id: 'm1', path: 'https://cdn/x.png' });
    expect(media.saveFile).toHaveBeenCalledWith(
      'org-1',
      'x.png',
      'https://cdn/x.png',
      undefined,
      true
    );
  });
});
