import { decodeScreenshot } from './problem.report.screenshot';
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
