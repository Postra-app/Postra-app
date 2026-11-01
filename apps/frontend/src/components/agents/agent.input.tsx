import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCopilotChatInternal,
  useCopilotContext,
  useCopilotReadable,
} from '@copilotkit/react-core';
import AutoResizingTextarea from '@gitroom/frontend/components/agents/agent.textarea';
import { useChatContext, InputProps } from '@copilotkit/react-ui';
const MAX_NEWLINES = 6;

export const Input = ({
  inProgress,
  onSend,
  chatReady = false,
  isVisible = false,
  onStop,
  onUpload,
  hideStopButton = false,
  onChange,
  placeholder,
}: InputProps & {
  onChange: (value: string) => void;
  placeholder?: string;
}) => {
  const context = useChatContext();
  const copilotContext = useCopilotContext();
  const showPoweredBy = !copilotContext.copilotApiConfig?.publicApiKey;

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isComposing, setIsComposing] = useState(false);

  const handleDivClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;

    // If the user clicked a button or inside a button, don't focus the textarea
    if (target.closest('button')) return;

    // If the user clicked the textarea, do nothing (it's already focused)
    if (target.tagName === 'TEXTAREA') return;

    // Otherwise, focus the textarea
    textareaRef.current?.focus();
  };

  const [text, setText] = useState('');
  // An open interrupt waits for its own answer, not a new message.
  const { interrupt, isAvailable } = useCopilotChatInternal();
  // A message sent before the chat had connected to its thread was lost
  // without a word (no run reached the server) and the box was cleared anyway.
  // Keep it and send it once the chat is connected. Should connecting never
  // finish, send after 15 s as before rather than leave the box stuck.
  const [queued, setQueued] = useState(false);
  const [waitedLong, setWaitedLong] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWaitedLong(true), 15_000);
    return () => clearTimeout(timer);
  }, []);
  const ready = chatReady && (isAvailable || waitedLong);
  const send = () => {
    if (inProgress) return;
    if (!ready) {
      setQueued(true);
      return;
    }
    setQueued(false);
    onSend(text);
    setText('');

    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (queued && ready && !inProgress && text.trim()) {
      send();
    }
  }, [queued, ready, inProgress]);

  const isInProgress = inProgress;
  const buttonIcon =
    isInProgress && !hideStopButton
      ? context.icons.stopIcon
      : context.icons.sendIcon;

  const canSend = useMemo(() => {
    return !isInProgress && text.trim().length > 0 && !interrupt;
  }, [interrupt, isInProgress, text]);

  const canStop = useMemo(() => {
    return isInProgress && !hideStopButton;
  }, [isInProgress, hideStopButton]);

  const sendDisabled = !canSend && !canStop;

  return (
    <div
      className={`copilotKitInputContainer ${
        showPoweredBy ? 'poweredByContainer' : ''
      }`}
    >
      <div className="copilotKitInput" onClick={handleDivClick}>
        <AutoResizingTextarea
          ref={textareaRef}
          placeholder={placeholder || context.labels.placeholder}
          autoFocus={false}
          maxRows={MAX_NEWLINES}
          value={text}
          onChange={(event) => {
            onChange(event.target.value);
            setText(event.target.value);
            // Only what was in the box at Enter may go out by itself: an
            // edit after it cancels the waiting send.
            setQueued(false);
          }}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => setIsComposing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
              event.preventDefault();
              if (canSend) {
                send();
              }
            }
          }}
        />
        <div className="copilotKitInputControls">
          {onUpload && (
            <button onClick={onUpload} className="copilotKitInputControlButton">
              {context.icons.uploadIcon}
            </button>
          )}

          <div style={{ flexGrow: 1 }} />
          <button
            disabled={sendDisabled}
            onClick={isInProgress && !hideStopButton ? onStop : send}
            data-copilotkit-in-progress={inProgress}
            data-copilotkit-ready={ready}
            data-test-id={
              inProgress
                ? 'copilot-chat-request-in-progress'
                : 'copilot-chat-ready'
            }
            className="copilotKitInputControlButton"
          >
            {buttonIcon}
          </button>
        </div>
      </div>
    </div>
  );
};
