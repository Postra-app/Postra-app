/** TikTok Direct Post audit — commercial-content disclosure rules from the Content Sharing Guidelines. */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TikTokDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/tiktok.dto';

const base = {
  privacy_level: 'PUBLIC_TO_EVERYONE',
  duet: false,
  stitch: false,
  comment: false,
  autoAddMusic: 'no',
  brand_content_toggle: false,
  brand_organic_toggle: false,
  content_posting_method: 'DIRECT_POST',
};

const messages = async (body: any) =>
  (await validate(plainToInstance(TikTokDto, { ...base, ...body }))).flatMap(
    (e) => Object.values(e.constraints ?? {})
  );

describe('TikTokDto', () => {
  it('accepts a plain post with nothing disclosed', async () => {
    expect(await messages({})).toEqual([]);
  });

  it('refuses disclosure without saying whose content it is', async () => {
    expect(await messages({ disclose: true })).toEqual([
      'You need to indicate if your content promotes yourself, a third party, or both.',
    ]);
  });

  it.each([
    { brand_organic_toggle: true },
    { brand_content_toggle: true },
    { brand_organic_toggle: true, brand_content_toggle: true },
  ])('accepts disclosure with %p', async (choice) => {
    expect(await messages({ disclose: true, ...choice })).toEqual([]);
  });

  it('refuses private branded content', async () => {
    expect(
      await messages({ disclose: true, brand_content_toggle: true, privacy_level: 'SELF_ONLY' })
    ).toEqual(['Branded content visibility cannot be set to private.']);
  });

  it('keeps private posts that are only your own brand', async () => {
    expect(
      await messages({ disclose: true, brand_organic_toggle: true, privacy_level: 'SELF_ONLY' })
    ).toEqual([]);
  });

  it('leaves upload-only to the TikTok app', async () => {
    expect(await messages({ content_posting_method: 'UPLOAD', disclose: true })).toEqual([]);
  });
});
