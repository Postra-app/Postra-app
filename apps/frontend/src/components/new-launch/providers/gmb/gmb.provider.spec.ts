import fs from 'fs';
import path from 'path';

// Google Business Profile publishes one local post: the backend sends only the
// first part, so the composer's "Add post" let a customer write parts that
// were dropped without a word.
describe('Google Business Profile composer', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gmb.provider.tsx'), 'utf8');

  it('offers no comments or extra posts', () => {
    expect(source).toMatch(/\n\s*comments: false,/);
  });
});
