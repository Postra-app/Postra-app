import { Request } from 'express';
import { requestFingerprint } from './auth.middleware';

const req = (headers: Record<string, string>, ip?: string) =>
  ({ headers, ip } as unknown as Request);

describe('requestFingerprint', () => {
  it('takes the address the ALB appended, not one the client sent', () => {
    expect(
      requestFingerprint(
        req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.77' })
      ).ip
    ).toBe('203.0.113.77');
  });

  it('falls back to the socket address without the header', () => {
    expect(requestFingerprint(req({}, '10.0.1.5')).ip).toBe('10.0.1.5');
  });

  it('keeps the user agent', () => {
    expect(
      requestFingerprint(req({ 'user-agent': 'curl/8' })).userAgent
    ).toBe('curl/8');
  });
});
