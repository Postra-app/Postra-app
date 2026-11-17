import { readFileSync } from 'fs';
import { join } from 'path';

// The calendar must use the check, and post its notices to our own origin
// only ('*' handed them to whatever site opened the window).
const src = readFileSync(join(__dirname, 'launches.component.tsx'), 'utf8');

describe('the calendar uses the connect message check', () => {
  it('does not toast the msg parameter itself', () => {
    expect(src).not.toMatch(/toast\.show\(search\.get\('msg'\)/);
    expect(src).toMatch(/connectMessageFromUrl\(/);
  });
  it('posts to its own origin, never to *', () => {
    expect(src).not.toMatch(/postMessage\([\s\S]{0,200}?'\*'\s*\)/);
  });
});
