import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TemplateSearchDto } from './studio.dto';

// AI-11: `[null]` passed the array check and failed later with a 500, and the
// 500-character cap on each entry's text was never applied.
const errors = async (body: unknown) =>
  (await validate(plainToInstance(TemplateSearchDto, body) as object)).length;

it('refuses broken template entries at the door', async () => {
  expect(await errors({ query: 'sale', templates: [null] })).toBeGreaterThan(0);
  expect(await errors({ query: 'sale', templates: [{ id: 't', text: 'x'.repeat(501) }] })).toBeGreaterThan(0);
  expect(await errors({ query: 'sale', templates: [{ id: 't', text: 'Summer sale' }] })).toBe(0);
});
