import { screenshotDataUrl } from './screenshot.data.url';
import { decodeScreenshot } from '@gitroom/backend/api/routes/problem.report.screenshot';

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(7)]);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(64).fill(7)]);

describe('problem report screenshot from the feedback widget', () => {
  // E2E-07-10: the widget labels its PNG "application/png"; the label made the
  // data URL unacceptable to the backend and every screenshot was dropped.
  it('turns the widget attachment into a data URL the backend keeps', () => {
    const url = screenshotDataUrl({ data: png, contentType: 'application/png' } as any)!;
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(decodeScreenshot(url)).toMatchObject({ type: 'image/png' });
    expect(decodeScreenshot(screenshotDataUrl({ data: jpeg })!)).toMatchObject({ type: 'image/jpeg' });
  });

  it('survives a screenshot larger than one chunk', () => {
    const big = new Uint8Array(200_000);
    big.set(png);
    expect(decodeScreenshot(screenshotDataUrl({ data: big })!)?.buffer.length).toBe(200_000);
  });

  it('sends nothing that is not a PNG or JPEG', () => {
    expect(screenshotDataUrl({ data: new TextEncoder().encode('<svg onload=alert(1)>') })).toBeUndefined();
    expect(screenshotDataUrl({ data: 'abc' })).toBeUndefined();
    expect(screenshotDataUrl(undefined)).toBeUndefined();
  });
});
