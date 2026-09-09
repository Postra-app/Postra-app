'use client';

import { create } from 'zustand';

export type EditorTool =
  | 'select'
  | 'text'
  | 'shapes'
  | 'images'
  | 'ai'
  | 'refine'
  | 'brand'
  | 'icons'
  | 'templates'
  | 'stock'
  | 'layers';

export interface PlatformSize {
  key: string;
  label: string;
  width: number;
  height: number;
}

// Labels stay untranslated on purpose. Every one that a user ever sees is a
// platform name plus an aspect ratio — "IG Story (9:16)", "X Post (16:9)" —
// and neither half translates: the names are proper nouns and the ratios are
// universal. The one entry that would need a translation, 'custom', is
// filtered out of the format bar and never rendered.
export const PLATFORM_SIZES: PlatformSize[] = [
  { key: 'instagram-feed', label: 'IG Feed (4:5)', width: 1080, height: 1350 },
  { key: 'instagram-square', label: 'IG Square (1:1)', width: 1080, height: 1080 },
  { key: 'instagram-story', label: 'IG Story (9:16)', width: 1080, height: 1920 },
  { key: 'facebook-feed', label: 'FB Feed (1:1)', width: 1080, height: 1080 },
  { key: 'linkedin-feed', label: 'LinkedIn (1:1)', width: 1200, height: 1200 },
  { key: 'tiktok-cover', label: 'TikTok (9:16)', width: 1080, height: 1920 },
  { key: 'x-post', label: 'X Post (16:9)', width: 1600, height: 900 },
  { key: 'custom', label: 'Custom', width: 1080, height: 1080 },
];

interface EditorState {
  activeTool: EditorTool;
  /**
   * The tool panel is a drawer now that the rail is icons-only: on a laptop
   * the rail plus a permanent 280px panel left the canvas with less room than
   * the panel it sat next to.
   */
  panelOpen: boolean;
  /**
   * Set when something outside the Templates panel wants it opened on a
   * particular search — the occasion chips on the free plan, which have no AI
   * to fall back on. The panel consumes it once and clears it.
   */
  pendingTemplateQuery: string | null;
  platform: PlatformSize;
  history: string[];
  historyIndex: number;
  isGenerating: boolean;
  canvasReady: boolean;
  bgColor: string;
  aiPrompt: string;

  setTool: (tool: EditorTool) => void;
  setPanelOpen: (open: boolean) => void;
  setPendingTemplateQuery: (query: string | null) => void;
  setPlatform: (platform: PlatformSize) => void;
  setGenerating: (val: boolean) => void;
  setCanvasReady: (val: boolean) => void;
  setBgColor: (color: string) => void;
  setAiPrompt: (prompt: string) => void;

  pushHistory: (json: string) => void;
  resetHistory: () => void;
  undo: () => string | null;
  redo: () => string | null;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  activeTool: 'select',
  panelOpen: true,
  pendingTemplateQuery: null,
  platform: PLATFORM_SIZES[0],
  history: [],
  historyIndex: -1,
  isGenerating: false,
  canvasReady: false,
  bgColor: '#1a1a2e',
  aiPrompt: '',

  setTool: (tool) => set({ activeTool: tool, panelOpen: true }),
  setPanelOpen: (open) => set({ panelOpen: open }),
  setPendingTemplateQuery: (query) => set({ pendingTemplateQuery: query }),
  setPlatform: (platform) => set({ platform }),
  setGenerating: (val) => set({ isGenerating: val }),
  setCanvasReady: (val) => set({ canvasReady: val }),
  setBgColor: (color) => set({ bgColor: color }),
  setAiPrompt: (prompt) => set({ aiPrompt: prompt }),

  // The store is module-global and outlives any single editor mount, so a new
  // editor has to start from a clean slate — otherwise Undo reaches back into
  // the previous session's canvas.
  resetHistory: () => set({ history: [], historyIndex: -1 }),

  pushHistory: (json) => {
    const { history, historyIndex } = get();
    const trimmed = history.slice(0, historyIndex + 1);
    const next = [...trimmed, json].slice(-30);
    set({ history: next, historyIndex: next.length - 1 });
  },

  undo: () => {
    const { history, historyIndex } = get();
    if (historyIndex <= 0) return null;
    const newIndex = historyIndex - 1;
    set({ historyIndex: newIndex });
    return history[newIndex];
  },

  redo: () => {
    const { history, historyIndex } = get();
    if (historyIndex >= history.length - 1) return null;
    const newIndex = historyIndex + 1;
    set({ historyIndex: newIndex });
    return history[newIndex];
  },
}));
