import { EventEmitter } from 'events';
import { HttpException } from '@nestjs/common';
import {
  SLOTS_PER_INSTANCE,
  UploadSlotsGuard,
  resetUploadSlots,
  uploadSlotsInUse,
} from './upload-slots.guard';

// Buffered uploads (up to 220 MB in memory each) are limited so
// a few accounts cannot take the instance down with parallel large bodies.
const call = (org: string, length?: number) => {
  const res: any = Object.assign(new EventEmitter(), { setHeader: jest.fn() });
  const req = { org: { id: org }, headers: length === undefined ? {} : { 'content-length': String(length) } };
  const ctx: any = { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  return { run: () => new UploadSlotsGuard().canActivate(ctx), res };
};
const status = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as HttpException).getStatus();
  }
  return 200;
};
const MB = 1024 * 1024;

describe('UploadSlotsGuard', () => {
  beforeEach(resetUploadSlots);

  it('lets small bodies through without a slot', () => {
    for (let i = 0; i < 20; i++) expect(call('org-a', 2 * MB).run()).toBe(true);
    expect(uploadSlotsInUse().total).toBe(0);
  });

  it('two large uploads per organisation at a time; the third gets 429 with Retry-After', () => {
    const a = call('org-a', 200 * MB);
    expect(a.run()).toBe(true);
    expect(call('org-a', 200 * MB).run()).toBe(true);
    const third = call('org-a', 200 * MB);
    expect(status(third.run)).toBe(429);
    expect(third.res.setHeader).toHaveBeenCalledWith('Retry-After', '10');
    // Another organisation is not held up by this one.
    expect(call('org-b', 200 * MB).run()).toBe(true);
  });

  it('a finished upload frees its slot, once even when both events fire', () => {
    const a = call('org-a', 200 * MB);
    a.run();
    call('org-a', 200 * MB).run();
    a.res.emit('finish');
    a.res.emit('close');
    expect(uploadSlotsInUse().total).toBe(1);
    expect(call('org-a', 200 * MB).run()).toBe(true);
    expect(status(call('org-a', 200 * MB).run)).toBe(429);
  });

  it('the instance takes at most four large uploads, whoever sends them', () => {
    for (let i = 0; i < SLOTS_PER_INSTANCE; i++) expect(call(`org-${i}`, 100 * MB).run()).toBe(true);
    expect(status(call('org-z', 100 * MB).run)).toBe(429);
  });

  it('a body without a length counts as large', () => {
    call('org-a', undefined).run();
    expect(uploadSlotsInUse().total).toBe(1);
  });
});
