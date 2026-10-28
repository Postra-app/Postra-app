import { plausibleEvent, routeTemplate } from './plausible.event';

describe('routeTemplate', () => {
  it.each([
    ['/launches', '/launches'],
    ['/p/cmh2x9k1z0001abcd/edit', '/p/:id/edit'],
    [
      '/integrations/social/instagram-standalone',
      '/integrations/social/instagram-standalone',
    ],
    ['/media/3f2b8c1e-9d4a-4f6b-8e2a-1c5d7e9f0a3b', '/media/:id'],
    ['/', '/'],
  ])('%s -> %s', (path, template) => {
    expect(routeTemplate(path)).toBe(template);
  });
});

// Node environment: a bare `window` is all the helper looks at.
const g = globalThis as any;

describe('plausibleEvent', () => {
  beforeEach(() => (g.window = {}));
  afterEach(() => delete g.window);

  it('sends the event with its props', () => {
    const plausible = jest.fn();
    g.window.plausible = plausible;
    plausibleEvent('error_shown', { page: '/launches' });
    expect(plausible).toHaveBeenCalledWith('error_shown', {
      props: { page: '/launches' },
    });
  });

  it('does nothing without the script or a window, and never throws', () => {
    delete g.window;
    expect(() => plausibleEvent('error_shown')).not.toThrow();
    g.window = {};
    expect(() => plausibleEvent('error_shown')).not.toThrow();
    g.window.plausible = () => {
      throw new Error('blocked');
    };
    expect(() => plausibleEvent('error_shown')).not.toThrow();
  });
});
