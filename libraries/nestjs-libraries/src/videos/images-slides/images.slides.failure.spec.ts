jest.mock('undici', () => ({
  ...jest.requireActual('undici'),
  fetch: jest.fn(async () => {
    throw new Error('elevenlabs timeout');
  }),
}));
// music-metadata 11 ships ESM only, which Jest's CommonJS runtime cannot
// even resolve (its exports have no CommonJS entry); this test fails before
// any audio is read.
jest.mock('music-metadata', () => ({ parseBuffer: jest.fn() }), { virtual: true });
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ uploadFile: jest.fn() }) },
}));

import { ImagesSlides } from './images.slides';

/**
 * AI-1 — an error inside `new Promise(async …)` rejected a promise nobody
 * held: the outer one never settled, the request hung, the reserved credit
 * was never refunded and Node saw an unhandled rejection.
 */
it('a failed image generation fails the video instead of hanging', async () => {
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const slides = new ImagesSlides(
      { generateSlidesFromText: async () => [{ imagePrompt: 'a', voiceText: 'b' }] } as any,
      { generateImageFromText: async () => { throw new Error('fal is down'); } } as any
    );

    const outcome = await Promise.race([
      slides.process('vertical', { prompt: 'x', voice: 'v' } as any).then(
        () => 'resolved',
        (e: Error) => `rejected: ${e.message}`
      ),
      new Promise((r) => setTimeout(() => r('still hanging'), 1000)),
    ]);

    expect(outcome).toMatch(/^rejected: /);
    await new Promise((r) => setImmediate(r));
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});
