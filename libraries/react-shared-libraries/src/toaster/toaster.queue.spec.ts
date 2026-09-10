import { addToast, removeToast, MAX_TOASTS, ToastItem } from './toaster.queue';

const toast = (id: number, text = `t${id}`): ToastItem => ({
  id,
  text,
  type: 'success',
});

describe('addToast', () => {
  it('stacks messages instead of replacing them', () => {
    const list = addToast(addToast([], toast(1)), toast(2));
    expect(list.map((t) => t.id)).toEqual([1, 2]);
  });

  it('drops the oldest once the stack is full', () => {
    let list: ToastItem[] = [];
    for (let i = 1; i <= MAX_TOASTS + 2; i += 1) list = addToast(list, toast(i));
    expect(list).toHaveLength(MAX_TOASTS);
    expect(list[0].id).toBe(3);
  });

  it('renews a repeated message rather than showing it twice', () => {
    const list = addToast(addToast([], toast(1, 'Upload failed')), toast(2, 'Upload failed'));
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(2);
  });
});

describe('removeToast', () => {
  it('removes only the one dismissed', () => {
    const list = removeToast([toast(1), toast(2)], 1);
    expect(list.map((t) => t.id)).toEqual([2]);
  });

  it('is a no-op for an id that already timed out', () => {
    expect(removeToast([toast(1)], 99)).toHaveLength(1);
  });
});
