// zod 4 dropped ZodError.errors, which @hookform/resolvers before 5 read to
// tell a validation failure from a crash: with a zod 4 schema the old resolver
// threw the ZodError instead of returning field errors, so the HeyGen form
// rejected every submit with an exception (Codex on the zod 4 bump,
// 2026-10-25; CI passed because the types still matched). The app's own zod
// and the resolvers must agree at runtime, not only in types.
describe('zodResolver with the app\'s zod', () => {
  it('returns field errors for invalid input instead of throwing', async () => {
    const { zodResolver } = require('@hookform/resolvers/zod');
    const { z } = require('zod');
    const schema = z.object({ text: z.string().min(20, 'at least 20') });
    const options = { fields: {}, shouldUseNativeValidation: false };
    const bad = await zodResolver(schema)({ text: 'short' }, undefined, options);
    expect(bad.errors.text.message).toBe('at least 20');
    const good = await zodResolver(schema)({ text: 'x'.repeat(20) }, undefined, options);
    expect(good.errors).toEqual({});
  });
});
