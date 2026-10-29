'use client';

import React, { FC, useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { BaseCopilotTextareaProps } from '@copilotkit/react-textarea';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

const BaseCopilotTextarea = dynamic(
  () =>
    import('@copilotkit/react-textarea').then((mod) => mod.BaseCopilotTextarea),
  { ssr: false }
);

// CopilotKit's own textarea no longer asks for suggestions (the request is a
// stub since 1.60), so this one asks /copilot/autocomplete. The surface picks
// the prompt on the server.
export type GhostSurface = 'signature' | 'post';

const noEditing = async () =>
  new ReadableStream<string>({
    start(controller) {
      controller.close();
    },
  });

export const GhostTextarea: FC<
  Omit<BaseCopilotTextareaProps, 'baseAutosuggestionsConfig'> & {
    surface: GhostSurface;
  }
> = ({ surface, ...props }) => {
  const fetch = useFetch();

  const baseAutosuggestionsConfig = useMemo(
    () => ({
      textareaPurpose: surface,
      // Cmd+K editing went with the same stub; only the suggestions stay.
      shouldToggleHoveringEditorOnKeyPress: () => false,
      apiConfig: {
        insertionOrEditingFunction: noEditing,
        autosuggestionsFunction: async (
          editorState: { textBeforeCursor: string; textAfterCursor: string },
          abortSignal: AbortSignal
        ) => {
          try {
            const response = await fetch('/copilot/autocomplete', {
              method: 'POST',
              body: JSON.stringify({
                surface,
                before: editorState.textBeforeCursor,
                after: editorState.textAfterCursor,
              }),
              signal: abortSignal,
            });
            if (!response.ok) return '';
            return (await response.json())?.suggestion || '';
          } catch {
            return '';
          }
        },
      },
    }),
    [fetch, surface]
  );

  return (
    <BaseCopilotTextarea
      {...props}
      baseAutosuggestionsConfig={baseAutosuggestionsConfig}
    />
  );
};
