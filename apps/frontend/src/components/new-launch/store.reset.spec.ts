import { useLaunchStore } from './store';

// "Repeat every 7 days" outlived the composer — reset()
// kept it, so the next, unrelated post was saved with `inter: 7` and repeated
// on the customer's channel.
describe('composer store reset', () => {
  it('clears the repeat interval', () => {
    useLaunchStore.getState().setRepeater(7);
    expect(useLaunchStore.getState().repeater).toBe(7);
    useLaunchStore.getState().reset();
    expect(useLaunchStore.getState().repeater).toBeUndefined();
  });
});
