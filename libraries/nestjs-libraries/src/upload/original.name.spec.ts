import { originalNameFromUrl } from '@gitroom/nestjs-libraries/upload/original.name';

// E2E-08-58: files uploaded through the public API had no original name, so
// the library search (by original name) never found them.
describe('originalNameFromUrl', () => {
  it('takes the last part of the path, decoded', () => {
    expect(originalNameFromUrl('https://example.com/photos/summer%20sale.jpg?w=800', 'jpg')).toBe('summer sale.jpg');
  });

  it('falls back to upload.<ext> without a file name', () => {
    expect(originalNameFromUrl('https://example.com/', 'png')).toBe('upload.png');
    expect(originalNameFromUrl('not a url', 'png')).toBe('upload.png');
  });

  it('keeps a bad escape as written and drops control characters', () => {
    expect(originalNameFromUrl('https://example.com/a%E0%A4%A.png', 'png')).toBe('a%E0%A4%A.png');
    expect(originalNameFromUrl('https://example.com/a%0Ab.png', 'png')).toBe('ab.png');
  });

  it('is at most 200 characters', () => {
    expect(originalNameFromUrl(`https://example.com/${'x'.repeat(500)}.png`, 'png')).toHaveLength(200);
  });
});
