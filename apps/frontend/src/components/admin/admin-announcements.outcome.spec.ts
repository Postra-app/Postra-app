import { deleteOutcome } from '@gitroom/frontend/components/admin/admin-ui';

/**
 * Three outcomes, and the middle one cannot be produced by clicking.
 *
 * Deleting an announcement that is already gone answers 200 with
 * `{deleted:false}` — the repository stopped throwing so the endpoint would
 * stop answering 500 (E2E-09-46) — and a handler checking only `res.ok`
 * reports that as a success for a delete that removed nothing (E2E-09-14).
 * Measured on production: DELETE on an unknown id answers 200.
 */
describe('deleteOutcome', () => {
  it('calls a real delete a delete', () => {
    expect(deleteOutcome(true, { deleted: true })).toBe('deleted');
  });

  it('does not call a 200 that removed nothing a success', () => {
    expect(deleteOutcome(true, { deleted: false })).toBe('already-gone');
  });

  it('calls a failed request a failure', () => {
    expect(deleteOutcome(false, { statusCode: 400 })).toBe('failed');
  });

  it('treats a 200 with an unreadable body as done', () => {
    // The row is gone as far as the server is concerned; refusing to believe a
    // 200 would leave the operator staring at an entry that is no longer there.
    expect(deleteOutcome(true, null)).toBe('deleted');
    expect(deleteOutcome(true, undefined)).toBe('deleted');
    expect(deleteOutcome(true, 'ok')).toBe('deleted');
  });

  it('is not fooled by a falsy-looking value that is not false', () => {
    expect(deleteOutcome(true, { deleted: 0 })).toBe('deleted');
    expect(deleteOutcome(true, { deleted: null })).toBe('deleted');
  });
});
