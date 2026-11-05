import {
  GB,
  MEDIA_STORAGE_FULL,
  formatBytes,
  sizeToRecord,
  storageFullError,
  storageLimit,
} from './media.storage';

// Media storage per plan. Starter 10 GB, Pro 25 GB,
// Business 100 GB, a trial (and no plan) 2 GB; off while billing is off.
describe('storageLimit', () => {
  it('follows the plan, and a trial is held to 2 GB whatever it runs on', () => {
    expect(storageLimit('STANDARD', false, true)).toBe(10 * GB);
    expect(storageLimit('PRO', false, true)).toBe(25 * GB);
    expect(storageLimit('ULTIMATE', false, true)).toBe(100 * GB);
    expect(storageLimit('ULTIMATE', true, true)).toBe(2 * GB);
    expect(storageLimit(null, false, true)).toBe(2 * GB);
  });

  it('is off while billing is off, like every other plan limit', () => {
    expect(storageLimit('STANDARD', false, false)).toBeNull();
  });
});

describe('storageFullError', () => {
  it('lets a file in that fits, up to the last byte', () => {
    expect(storageFullError(9 * GB, 10 * GB, GB)).toBeNull();
    expect(storageFullError(0, null, 50 * GB)).toBeNull();
  });

  it('refuses one that does not, with 402, a code for the app and the numbers in words', () => {
    const e = storageFullError(9.5 * GB, 10 * GB, GB)!;
    expect(e.getStatus()).toBe(402);
    expect(e.getResponse()).toEqual({
      code: MEDIA_STORAGE_FULL,
      used: 9.5 * GB,
      limit: 10 * GB,
      message:
        'Your media library is full: 9.5 GB of 10 GB on your plan. Delete files you no longer need, or upgrade your plan for more space.',
    });
  });

  it('a library already over (a downgrade) refuses even a small file', () => {
    expect(storageFullError(30 * GB, 10 * GB, 1)).not.toBeNull();
  });
});

describe('formatBytes', () => {
  it('reads like a person would say it', () => {
    expect(formatBytes(1.25 * GB)).toBe('1.3 GB');
    expect(formatBytes(10 * GB)).toBe('10 GB');
    expect(formatBytes(850 * 1024 * 1024)).toBe('850 MB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(0)).toBe('0 KB');
  });
});

describe('sizeToRecord', () => {
  it('takes the size the caller held, without asking the storage', async () => {
    const storage = { sizeOf: jest.fn() };
    expect(await sizeToRecord(1234, storage, 'https://cdn/x.jpg')).toBe(1234);
    expect(storage.sizeOf).not.toHaveBeenCalled();
  });

  it('otherwise asks the storage', async () => {
    const storage = { sizeOf: jest.fn(async () => 999) };
    expect(await sizeToRecord(undefined, storage, 'https://cdn/x.jpg')).toBe(999);
    expect(storage.sizeOf).toHaveBeenCalledWith('https://cdn/x.jpg');
  });

  it('a storage that cannot tell, or fails, records 0 and never blocks the save', async () => {
    expect(await sizeToRecord(0, { sizeOf: async () => null }, 'p')).toBe(0);
    expect(await sizeToRecord(undefined, { sizeOf: async () => { throw new Error('403'); } }, 'p')).toBe(0);
    expect(await sizeToRecord(undefined, {}, 'p')).toBe(0);
  });
});
