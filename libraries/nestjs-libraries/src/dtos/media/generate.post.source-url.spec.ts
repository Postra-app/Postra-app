import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GeneratePostDesignDto } from './generate.post.design.dto';
import { GeneratePostCarouselDto } from './generate.post.carousel.dto';

// Studio "From a link": the article is the brief, the prompt an optional note.
const cases: [string, any, Record<string, unknown>][] = [
  ['design', GeneratePostDesignDto, { platform: 'instagram-feed' }],
  ['carousel', GeneratePostCarouselDto, { platform: 'instagram-feed', slidesCount: 3 }],
];

describe.each(cases)('%s request', (_name, Dto, base) => {
  const errors = async (extra: Record<string, unknown>) =>
    (await validate(plainToInstance(Dto, { ...base, ...extra }) as object)).map((e) => e.property);

  it('takes a prompt alone, as before', async () => {
    expect(await errors({ prompt: 'Summer sale' })).toEqual([]);
  });

  it('still needs a prompt when there is no link', async () => {
    expect(await errors({})).toEqual(['prompt']);
    expect(await errors({ prompt: 'ab' })).toEqual(['prompt']);
  });

  it('takes an https link alone, or with a note', async () => {
    expect(await errors({ sourceUrl: 'https://blog.example/post' })).toEqual([]);
    expect(await errors({ sourceUrl: 'https://blog.example/post', prompt: 'for agencies' })).toEqual([]);
  });

  it('holds the note to the prompt rules and the link to https', async () => {
    expect(await errors({ sourceUrl: 'https://blog.example/post', prompt: 'x'.repeat(501) })).toEqual(['prompt']);
    expect(await errors({ sourceUrl: 'http://blog.example/post' })).toEqual(['sourceUrl']);
    expect(await errors({ sourceUrl: 'file:///etc/passwd' })).toEqual(['sourceUrl']);
    expect(await errors({ sourceUrl: 'blog.example/post' })).toEqual(['sourceUrl']);
  });
});
