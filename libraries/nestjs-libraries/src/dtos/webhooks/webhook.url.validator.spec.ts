import { isBlockedIp } from './webhook.url.validator';

// Upstream 5f18f1ca6 (2026-10-24): the string checks compared the dotted
// IPv4-mapped form only. The URL parser normalises [::ffff:127.0.0.1] to
// ::ffff:7f00:1, which no check matched, and a dual-stack socket then
// connected to 127.0.0.1. Same for the instance metadata address, NAT64
// and 6to4 embeddings, and the IPv4-compatible ::a.b.c.d form.
describe('isBlockedIp', () => {
  const hostnameOf = (url: string) =>
    new URL(url).hostname.replace(/^\[|\]$/g, '');

  it.each([
    'https://[::ffff:127.0.0.1]/',
    'https://[::ffff:7f00:1]/',
    'https://[::ffff:169.254.169.254]/',
    'https://[::ffff:10.0.0.1]/',
    'https://[64:ff9b::7f00:1]/',
    'https://[2002:7f00:1::]/',
    'https://[::127.0.0.1]/',
    'https://[::1]/',
    'https://[fe80::1]/',
    'https://[fd00::1]/',
    'https://127.0.0.1/',
    'https://169.254.169.254/',
    'https://10.1.2.3/',
    'https://172.16.0.1/',
    'https://192.168.1.1/',
    'https://100.64.0.1/',
    'https://0.0.0.0/',
  ])('blocks %s', (url) => {
    expect(isBlockedIp(hostnameOf(url))).toBe(true);
  });

  it.each([
    'https://8.8.8.8/',
    'https://[::ffff:8.8.8.8]/',
    'https://[2606:4700::6810:84e5]/',
    'https://172.32.0.1/',
  ])('lets %s through', (url) => {
    expect(isBlockedIp(hostnameOf(url))).toBe(false);
  });

  it('treats anything that is not an IP as blocked', () => {
    expect(isBlockedIp('localhost')).toBe(true);
    expect(isBlockedIp('')).toBe(true);
  });
});
