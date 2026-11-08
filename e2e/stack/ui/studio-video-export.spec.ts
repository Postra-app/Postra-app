import { readFileSync } from 'fs';
import { expect, Page, Request, Response, test } from '@playwright/test';
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny';
import { watchForErrors } from './ui-helpers';

// Every Video tool that renders in the browser, run to the file it uploads, in
// Chromium and in WebKit (Safari's engine). Safari decodes H.264 and AAC,
// Playwright's Chromium only VP8 and Opus, so each engine gets the clip it can
// play: the same two seconds of a test pattern with a 440 Hz tone. The uploaded
// bytes are then read back here, so "it rendered" means a real MP4 with
// picture and sound, not a spinner that stopped.

test.use({ viewport: { width: 1440, height: 900 } });

const fixture = (browserName: string) =>
  browserName === 'webkit'
    ? { name: 'tone.mp4', mimeType: 'video/mp4', buffer: readFileSync(`${__dirname}/fixtures/tone-two-seconds.mp4`) }
    : { name: 'tone.webm', mimeType: 'video/webm', buffer: readFileSync(`${__dirname}/fixtures/tone-two-seconds.webm`) };

// The sound is copied, not re-encoded: the output keeps the source's codec.
const sourceAudio = (browserName: string) => (browserName === 'webkit' ? 'aac' : 'opus');

const loadClip = async (page: Page, browserName: string) => {
  await page.goto('/studio?mode=video');
  await page.locator('input[type="file"][accept="video/*"]').first().setInputFiles(fixture(browserName));
  await page.getByRole('button', { name: 'Trim', exact: true }).click();
  await expect(page.getByText(/^End: [12]\.\d\ds$/)).toBeVisible({ timeout: 30_000 });
};

const isUpload = (r: Request) => r.url().includes('/media/upload-simple') && r.method() === 'POST';

const probe = async (bytes: Buffer) => {
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  return {
    mime: await input.getMimeType(),
    duration: await input.computeDuration(),
    size: video ? `${video.displayWidth}x${video.displayHeight}` : null,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
  };
};

/** Clicks a save button and reads back every file it stored. */
const saveAll = async (page: Page, button: string, count = 1) => {
  const stored: Promise<string>[] = [];
  const onResponse = (r: Response) => {
    if (isUpload(r.request())) {
      stored.push(
        r.json().then((body) => {
          expect(r.status(), JSON.stringify(body)).toBe(201);
          return body.path as string;
        })
      );
    }
  };
  page.on('response', onResponse);
  await page.getByRole('button', { name: button, exact: true }).last().click();
  await expect.poll(() => stored.length, { timeout: 60_000 }).toBe(count);
  page.off('response', onResponse);
  const paths = await Promise.all(stored);
  return Promise.all(
    paths.map(async (path) => {
      const file = await page.request.get(path);
      expect(file.status(), path).toBe(200);
      return probe(await file.body());
    })
  );
};

test('Trim exports a shorter MP4 with its sound', { tag: '@safari' }, async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const problems = watchForErrors(page);
  await loadClip(page, browserName);
  await page.getByRole('slider', { name: 'Start' }).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Export trimmed clip', exact: true }).click();
  await expect(page.getByText('Trimmed. Continue', { exact: false })).toBeVisible({ timeout: 60_000 });
  const [file] = await saveAll(page, 'Save to library');
  expect(file.mime).toContain('video/mp4');
  expect(file.videoCodec).toBe('avc');
  expect(file.audioCodec).toBe(sourceAudio(browserName));
  expect(file.duration).toBeGreaterThan(0.7);
  expect(file.duration).toBeLessThan(1.3);
  expect(problems).toEqual([]);
});

test('Formats exports every format at its own size, with sound', { tag: '@safari' }, async ({ page, browserName }) => {
  test.setTimeout(240_000);
  const problems = watchForErrors(page);
  await loadClip(page, browserName);
  await page.getByRole('button', { name: 'Formats', exact: true }).click();
  for (const box of await page.getByRole('checkbox').all()) {
    if (!(await box.isChecked())) await box.check();
  }
  await page.getByRole('button', { name: 'Export 4 formats', exact: true }).click();
  await expect(page.getByText('All are kept', { exact: false })).toBeVisible({ timeout: 200_000 });
  const files = await saveAll(page, 'Save to library', 4);
  expect(files.map((f) => f.size).sort()).toEqual(['1080x1080', '1080x1350', '1080x1920', '1920x1080']);
  for (const f of files) {
    expect(f.audioCodec).toBe(sourceAudio(browserName));
    expect(f.duration).toBeGreaterThan(1.5);
  }
  expect(problems).toEqual([]);
});

test('Text burns Polish text into the clip and keeps the sound', { tag: '@safari' }, async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const problems = watchForErrors(page);
  await page.goto('/studio?mode=video');
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'From disk', exact: true }).click();
  await (await chooser).setFiles(fixture(browserName));
  await page.getByPlaceholder('Text on video').fill('Zażółć gęślą jaźń: a long line that has to wrap');
  await page.getByRole('button', { name: 'Burn text into video', exact: true }).click();
  await expect(page.getByText('with audio', { exact: true })).toBeVisible({ timeout: 60_000 });
  const [file] = await saveAll(page, 'Save to library');
  expect(file.audioCodec).toBe(sourceAudio(browserName));
  expect(file.duration).toBeGreaterThan(1.5);
  expect(problems).toEqual([]);
});

// Whisper runs on the server and is the same for every browser; the browser's
// part is uploading the clip and burning the captions in.
test('AI Captions burns the captions into the clip', { tag: '@safari' }, async ({ page, browserName }) => {
  test.setTimeout(120_000);
  const problems = watchForErrors(page);
  await page.route('**/api/media/*/auto-caption', (route) =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        srt: '1\n00:00:00,000 --> 00:00:01,000\nHello from Postra\n\n2\n00:00:01,000 --> 00:00:02,000\nZażółć gęślą jaźń\n',
      }),
    })
  );
  await loadClip(page, browserName);
  const clipUpload = page.waitForResponse((r) => isUpload(r.request()));
  await page.getByRole('button', { name: 'AI Captions', exact: true }).click();
  expect((await clipUpload).status()).toBe(201);
  await page.getByRole('button', { name: 'Generate captions', exact: true }).click();
  await page.getByRole('button', { name: 'Burn into video', exact: true }).click();
  await expect(page.getByText('with audio', { exact: true })).toBeVisible({ timeout: 60_000 });
  const [file] = await saveAll(page, 'Save to library');
  expect(file.audioCodec).toBe(sourceAudio(browserName));
  expect(file.duration).toBeGreaterThan(1.5);
  expect(problems).toEqual([]);
});

// An iPhone records HEVC in a .MOV. Safari decodes it; X and LinkedIn refuse
// HEVC, so Trim re-encodes it to H.264. Engines without an HEVC decoder (the
// Linux builds) cannot open the clip at all and skip.
test('an iPhone HEVC clip comes out of Trim as H.264 with its sound', { tag: '@safari' }, async ({
  page,
  browserName,
}) => {
  test.setTimeout(120_000);
  test.skip(browserName !== 'webkit', 'Safari is the browser that opens HEVC');
  await page.goto('/studio?mode=video');
  const hevc = await page.evaluate(() =>
    VideoDecoder.isConfigSupported({ codec: 'hvc1.1.6.L93.B0', codedWidth: 360, codedHeight: 640 })
      .then((r) => !!r.supported)
      .catch(() => false)
  );
  test.skip(!hevc, 'this WebKit build has no HEVC decoder');
  await page
    .locator('input[type="file"][accept="video/*"]')
    .first()
    .setInputFiles({
      name: 'IMG_0001.MOV',
      mimeType: 'video/quicktime',
      buffer: readFileSync(`${__dirname}/fixtures/iphone-hevc-two-seconds.mov`),
    });
  await page.getByRole('button', { name: 'Trim', exact: true }).click();
  await expect(page.getByText(/^End: [12]\.\d\ds$/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Export trimmed clip', exact: true }).click();
  await expect(page.getByText('Trimmed. Continue', { exact: false })).toBeVisible({ timeout: 90_000 });
  const [file] = await saveAll(page, 'Save to library');
  expect(file.videoCodec).toBe('avc');
  expect(file.audioCodec).toBe('aac');
  expect(file.size).toBe('360x640');
  expect(file.duration).toBeGreaterThan(1.5);
});
