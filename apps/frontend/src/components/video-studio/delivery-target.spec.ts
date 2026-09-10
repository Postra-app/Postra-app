import { deliveryTarget } from './delivery-target';

describe('deliveryTarget', () => {
  it('hands the file to the post when the user is on the tab that made it', () => {
    expect(deliveryTarget('composer', 'captions', 'captions')).toBe('post');
  });

  it('keeps the modal open when the render finished on a tab left behind', () => {
    expect(deliveryTarget('composer', 'text', 'captions')).toBe('bar');
  });

  it('treats a direct request with no origin as the user asking now', () => {
    expect(deliveryTarget('composer', 'trim')).toBe('post');
  });

  it('never closes anything in the standalone studio', () => {
    expect(deliveryTarget('studio', 'captions', 'captions')).toBe('bar');
    expect(deliveryTarget('studio', 'trim')).toBe('bar');
  });
});
