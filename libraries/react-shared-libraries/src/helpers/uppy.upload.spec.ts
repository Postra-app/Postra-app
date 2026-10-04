jest.mock('@uppy/xhr-upload', () => ({}));
jest.mock('@uppy/aws-s3', () => ({}));
jest.mock('@uppy/transloadit', () => ({}));

import { getUppyUploadPlugin } from './uppy.upload';

// @uppy/aws-s3 takes whatever a multipart callback returns as a finished step.
// Our fetch wrapper does not throw on HTTP errors, so a 500 from
// /media/complete-multipart-upload became a "successful" file without `saved`,
// and the composer crashed reading `.path` of undefined (upstream 22f266aa).

const reply = (status: number, body: unknown) => async () => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const s3 = (fetch: any) => getUppyUploadPlugin('s3', fetch, '').options as any;

describe('multipart upload callbacks', () => {
  it.each([
    'listParts',
    'signPart',
    'abortMultipartUpload',
    'completeMultipartUpload',
  ])('%s fails the step when the backend answers with an error', async (step) => {
    const options = s3(reply(500, { message: 'Internal server error' }));
    await expect(options[step]({ name: 'a.png' }, {})).rejects.toThrow(
      'Internal server error'
    );
  });

  it('createMultipartUpload fails the step on an error too', async () => {
    const options = s3(reply(400, { message: 'Bad file' }));
    await expect(
      options.createMultipartUpload({ name: 'a.png', type: 'image/png', size: 4, data: new Blob(['abcd']) })
    ).rejects.toThrow('Bad file');
  });

  it('returns the body of a successful step', async () => {
    const options = s3(reply(201, { saved: { id: 'm1', path: 'https://cdn/x.png' } }));
    await expect(options.completeMultipartUpload({ name: 'a.png' }, {})).resolves.toEqual({
      saved: { id: 'm1', path: 'https://cdn/x.png' },
    });
  });
});
