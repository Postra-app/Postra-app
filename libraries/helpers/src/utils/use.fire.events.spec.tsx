// The repo's own jsdom, as in client-language.spec.tsx (jest-environment-jsdom
// bundles an older one that crashes on the optional `canvas` module).
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://app.postra.co.uk/launches',
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});

let billingEnabled = true;
jest.mock('@gitroom/react/helpers/variable.context', () => ({
  useVariables: () => ({ billingEnabled }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { renderHook } = require('@testing-library/react');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useFireEvents } = require('./use.fire.events');

// Our Plausible events (sign-up, post saved, channel connect failed) go
// through next-plausible's usePlausible to the script the app layout loads.
// A major of next-plausible must not change that call (v4, 2 XI).
describe('useFireEvents', () => {
  beforeEach(() => {
    (window as any).plausible = jest.fn();
  });

  it('hands the event and its props to the Plausible script', () => {
    billingEnabled = true;
    const { result } = renderHook(() => useFireEvents());
    result.current('post_saved', { type: 'schedule' });
    expect((window as any).plausible).toHaveBeenCalledWith('post_saved', {
      props: { type: 'schedule' },
    });
  });

  it('sends nothing on an install without billing (self-hosted)', () => {
    billingEnabled = false;
    const { result } = renderHook(() => useFireEvents());
    result.current('post_saved');
    expect((window as any).plausible).not.toHaveBeenCalled();
  });

  it('does not break when the script is not loaded', () => {
    billingEnabled = true;
    delete (window as any).plausible;
    const { result } = renderHook(() => useFireEvents());
    expect(() => result.current('post_saved')).not.toThrow();
  });
});
