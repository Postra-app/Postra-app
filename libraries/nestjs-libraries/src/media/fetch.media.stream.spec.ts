import { fetchMediaBlob, fetchMediaStream } from './fetch.media.buffer';

// U1 (upstream 6c4a8ca4): YouTube and Discord fetched a post's media path —
// client-controlled — with plain axios / fetch, so a path pointing inside the
// VPC reached it from the worker. They now go through these helpers.
describe('media fetch helpers refuse internal addresses', () => {
  it.each([
    'https://169.254.169.254/latest/meta-data/iam/security-credentials/',
    'https://127.0.0.1/admin',
    'https://localhost:5000/api/monitor/queue/main',
    'https://10.0.1.229/',
    'http://cdn-dev.postra.pl/video.mp4',
    'file:///etc/passwd',
  ])('%s', async (url) => {
    await expect(fetchMediaStream(url)).rejects.toThrow(/blocked request/);
    await expect(fetchMediaBlob(url)).rejects.toThrow(/blocked request/);
  });
});
