'use client';

import { FC, ReactNode } from 'react';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { DndProvider } from 'react-dnd';

// Without a context react-dnd keeps its manager in a global that the provider
// clears from an effect cleanup: a remount of the calendar in the same tick
// builds a second manager while the first still owns the window listeners,
// and the backend throws "Cannot have two HTML5 backends at the same time"
// (upstream 549da5d4c). Window as the context keeps one manager for the
// app's lifetime; the backend still gets window as its root.
const dndContext = typeof window === 'undefined' ? undefined : window;

export const DNDProvider: FC<{
  children: ReactNode;
}> = ({ children }) => {
  return (
    <DndProvider backend={HTML5Backend} context={dndContext}>
      {children}
    </DndProvider>
  );
};
