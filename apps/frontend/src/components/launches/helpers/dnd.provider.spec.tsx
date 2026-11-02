/**
 * @jest-environment jsdom
 */
const providerProps: Array<Record<string, unknown>> = [];
jest.mock('react-dnd', () => ({
  DndProvider: (props: Record<string, unknown> & { children: unknown }) => {
    providerProps.push(props);
    return props.children;
  },
}));
jest.mock('react-dnd-html5-backend', () => ({ HTML5Backend: () => ({}) }));

import { renderToStaticMarkup } from 'react-dom/server';
import { DNDProvider } from './dnd.provider';

// Upstream 549da5d4c: without a context a calendar remount built a second
// drag-and-drop manager and the HTML5 backend threw "Cannot have two HTML5
// backends at the same time".
describe('DNDProvider', () => {
  it('keeps one drag-and-drop manager on window for every mount', () => {
    renderToStaticMarkup(<DNDProvider>a</DNDProvider>);
    renderToStaticMarkup(<DNDProvider>b</DNDProvider>);
    expect(providerProps).toHaveLength(2);
    expect(providerProps[0].context).toBe(window);
    expect(providerProps[1].context).toBe(window);
  });
});
