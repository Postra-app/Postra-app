import { decodeScreenshot, isScreenshotFile, screenshotLink } from './problem.report.screenshot';
import { problemReportHtml } from './problem.report';

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)]);
const url = (type: string, b: Buffer) => `data:image/${type};base64,${b.toString('base64')}`;

describe('problem report screenshot', () => {
  it('keeps a real PNG or JPEG', () => {
    expect(decodeScreenshot(url('png', png))).toMatchObject({ type: 'image/png', ext: 'png' });
    expect(decodeScreenshot(url('jpeg', jpeg))).toMatchObject({ type: 'image/jpeg', ext: 'jpg' });
  });

  it('drops anything whose bytes do not match the label', () => {
    expect(decodeScreenshot(url('png', jpeg))).toBeNull();
    expect(decodeScreenshot(url('png', Buffer.from('<svg onload=alert(1)>')))).toBeNull();
    expect(decodeScreenshot('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodeScreenshot('data:text/html;base64,PGI+')).toBeNull();
    expect(decodeScreenshot(undefined)).toBeNull();
  });

  it('drops a screenshot over 5 MB', () => {
    const big = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);
    expect(decodeScreenshot(url('png', big))).toBeNull();
  });

  // A presigned link signed with the server's role dies within hours, so the
  // mail points at the admin route, which signs a fresh one on every click.
  it('links the mail to the admin route, not to a signed S3 URL', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postra.pl/api';
    const file = '3f2b6a1c-0d4e-4b8a-9c1e-2a3b4c5d6e7f.png';
    expect(screenshotLink(file)).toBe(`https://app.postra.pl/api/admin/problem-reports/${file}`);
    expect(problemReportHtml({ message: 'x', email: 'a@b.co', organization: 'O', screenshotUrl: screenshotLink(file) }))
      .not.toContain('valid 7 days');
  });

  it('opens only a file name the server itself could have written', () => {
    expect(isScreenshotFile('3f2b6a1c-0d4e-4b8a-9c1e-2a3b4c5d6e7f.png')).toBe(true);
    expect(isScreenshotFile('3f2b6a1c-0d4e-4b8a-9c1e-2a3b4c5d6e7f.jpg')).toBe(true);
    expect(isScreenshotFile('../uploads/x.png')).toBe(false);
    expect(isScreenshotFile('3f2b6a1c-0d4e-4b8a-9c1e-2a3b4c5d6e7f.png/../a')).toBe(false);
    expect(isScreenshotFile('anything.svg')).toBe(false);
  });

  it('puts the link in the mail, escaped', () => {
    const html = problemReportHtml({
      message: 'x',
      email: 'a@b.co',
      organization: 'O',
      screenshotUrl: 'https://s3.example/k.png?X-Amz-Signature=a&b="c"',
    });
    expect(html).toContain('href="https://s3.example/k.png?X-Amz-Signature=a&amp;b=&quot;c&quot;"');
  });
});
