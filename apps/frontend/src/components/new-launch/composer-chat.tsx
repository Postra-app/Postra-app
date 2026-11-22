'use client';

import {
  FC,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import {
  CHAT_MAX_MESSAGE,
  ChatMessage,
  ComposerValue,
  chatPayload,
  putPost,
  putThread,
  sameComposer,
} from '@gitroom/frontend/components/new-launch/composer-chat.utils';

// The assistant in the corner of the composer: ask for a post, read the
// draft, press "Use in post". It writes text and nothing else. Nothing reaches
// the post until that button, and the button's other face is Undo.
//
// It talks to /media/ai-chat, which is gated, throttled and metered like the
// ribbon under the editor, and reads the Brand Kit. No chat library: the
// composer loads this with the ~2 KB it is.

interface Used {
  /** `${message id}:${index}`, or `${message id}:thread`. */
  key: string;
  /** 'global', or the channel whose own version was written. */
  target: string;
  before: ComposerValue[];
  /** What was written; Undo lasts while the post still says this. */
  after: ComposerValue[];
}

export const ComposerChat: FC = () => {
  const fetch = useFetch();
  const t = useT();

  const {
    current,
    global,
    internal,
    selectedIntegrations,
    setGlobalValue,
    setInternalValue,
  } = useLaunchStore(
    useShallow((state) => ({
      current: state.current,
      global: state.global,
      internal: state.internal,
      selectedIntegrations: state.selectedIntegrations,
      setGlobalValue: state.setGlobalValue,
      setInternalValue: state.setInternalValue,
    }))
  );

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [used, setUsed] = useState<Used | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // What the editor is showing: the channel's own version when it has one,
  // otherwise the text every channel shares (same rule as the editor).
  const own = useMemo(
    () => internal.find((item) => item.integration.id === current),
    [internal, current]
  );
  const target = own ? current : 'global';
  const composer: ComposerValue[] = useMemo(
    () => (own ? own.integrationValue : global) ?? [],
    [own, global]
  );

  const platform = useMemo(() => {
    const onTab = selectedIntegrations.find(
      (item) => item.integration.id === current
    );
    if (onTab) return onTab.integration.identifier;
    return selectedIntegrations.length === 1
      ? selectedIntegrations[0].integration.identifier
      : undefined;
  }, [selectedIntegrations, current]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy, open]);

  const write = useCallback(
    (where: string, value: ComposerValue[]) =>
      where === 'global' ? setGlobalValue(value) : setInternalValue(where, value),
    [setGlobalValue, setInternalValue]
  );

  const apply = useCallback(
    (key: string, value: ComposerValue[]) => {
      setUsed({ key, target, before: composer, after: value });
      write(target, value);
    },
    [target, composer, write]
  );

  // Undo puts back every post as it was before "Use in post". Once the user
  // has typed, added a picture or another post, that would take their work
  // with it, so the offer ends there and the button is "Use in post" again.
  useEffect(() => {
    if (!used) return;
    const now =
      used.target === 'global'
        ? global
        : internal.find((item) => item.integration.id === used.target)
            ?.integrationValue;
    if (!sameComposer(used.after, now ?? [])) setUsed(null);
  }, [used, global, internal]);

  const undo = useCallback(() => {
    if (!used) return;
    write(used.target, used.before);
    setUsed(null);
  }, [used, write]);

  const send = useCallback(
    async (event?: FormEvent) => {
      event?.preventDefault();
      const text = draft.trim().slice(0, CHAT_MAX_MESSAGE);
      if (!text || busy) return;

      const next: ChatMessage[] = [
        ...messages,
        { id: makeId(8), role: 'user', content: text },
      ];
      setMessages(next);
      setDraft('');
      setBusy(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const fail = (content: string) =>
        setMessages((prev) => [
          ...prev,
          { id: makeId(8), role: 'assistant', content, error: true },
        ]);

      try {
        const res = await fetch('/media/ai-chat', {
          method: 'POST',
          body: JSON.stringify(chatPayload(next, composer, platform)),
          signal: ctrl.signal,
        });

        if (!res.ok) {
          let said = '';
          try {
            const body = await res.clone().json();
            said = typeof body?.message === 'string' ? body.message : '';
          } catch {
            // not JSON: the sentences below cover it
          }
          // 402 opens the shared dialog with the way to billing.
          if (res.status === 402) return;
          fail(
            res.status === 429
              ? t(
                  'ai_rate_limited',
                  'Too many requests - wait a few seconds and try again.'
                )
              : said ||
                  t(
                    'assistant_failed',
                    'I could not answer just now - try again in a moment.'
                  )
          );
          return;
        }

        const data = (await res.json()) as {
          reply?: string;
          posts?: string[] | null;
          thread?: boolean;
        };
        const posts = (data?.posts ?? []).filter(Boolean);
        if (!data?.reply && !posts.length) {
          fail(
            t(
              'assistant_failed',
              'I could not answer just now - try again in a moment.'
            )
          );
          return;
        }
        setMessages((prev) => [
          ...prev,
          {
            id: makeId(8),
            role: 'assistant',
            content: data.reply ?? '',
            posts: posts.length ? posts : undefined,
            thread: !!data.thread && posts.length > 1,
          },
        ]);
      } catch (err) {
        if (
          (err as { name?: string })?.name !== 'AbortError' &&
          !isFetchHandledError(err)
        ) {
          fail(
            t(
              'assistant_failed',
              'I could not answer just now - try again in a moment.'
            )
          );
        }
      } finally {
        if (abortRef.current === ctrl) abortRef.current = null;
        setBusy(false);
      }
    },
    [draft, busy, messages, composer, platform, fetch, t]
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      // Enter sends, Shift+Enter is a new line; an IME still composing a
      // character must not send half a word.
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        send();
      }
    },
    [send]
  );

  const renderUse = (key: string, label: string, value: () => ComposerValue[]) =>
    used?.key === key ? (
      <button
        type="button"
        onClick={undo}
        className="text-[12px] px-2.5 py-1 rounded bg-newColColor hover:bg-white/[0.08] text-newTextColor/90 transition-colors"
      >
        {t('assistant_undo', 'Undo')}
      </button>
    ) : (
      <button
        type="button"
        onClick={() => apply(key, value())}
        className="text-[12px] px-2.5 py-1 rounded bg-newAccent text-[#06222e] font-[600] hover:bg-forth transition-colors"
      >
        {label}
      </button>
    );

  // On a phone the bottom of the composer is three rows of its own buttons;
  // the free spot is the end of the tags row above them.
  return (
    <div className="composer-chat absolute bottom-[10px] end-[10px] phone:bottom-[176px] phone:end-[8px] z-[250] flex flex-col items-end gap-[10px] pointer-events-none">
      {open && (
        <section
          role="dialog"
          aria-label={t('assistant_title', '✨ AI Assistant')}
          className="pointer-events-auto w-[380px] max-w-[calc(100vw-16px)] h-[520px] max-h-[calc(100vh-220px)] mb-[34px] phone:mb-0 phone:fixed phone:inset-[8px] phone:w-auto phone:max-w-none phone:h-auto phone:max-h-none phone:z-[260] flex flex-col rounded-[16px] border border-newBorder bg-newBgColor shadow-2xl overflow-hidden text-newTextColor"
        >
          <header className="flex items-center gap-2 h-[48px] px-[14px] border-b border-newBorder shrink-0">
            <h2 className="flex-1 text-[14px] font-[600]">
              {t('assistant_title', '✨ AI Assistant')}
            </h2>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  abortRef.current?.abort();
                  setMessages([]);
                  // its button went with the conversation
                  setUsed(null);
                }}
                className="text-[12px] text-newTextColor/60 hover:text-newTextColor transition-colors"
              >
                {t('assistant_new_chat', 'New chat')}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('assistant_close', 'Close the assistant')}
              className="w-[28px] h-[28px] rounded-full hover:bg-white/[0.08] text-[16px] leading-none"
            >
              ×
            </button>
          </header>

          <div
            ref={listRef}
            tabIndex={0}
            aria-live="polite"
            className="flex-1 overflow-y-auto p-[12px] flex flex-col gap-[10px] text-[13px] leading-relaxed"
          >
            <div className="self-start max-w-[92%] rounded-[12px] rounded-ss-[4px] bg-newColColor px-[12px] py-[8px]">
              {t(
                'assistant_initial_message',
                "Hi! 👋 I'll help you write a great social media post. Tell me what you want to write about - or if you already have a draft, how I should improve it."
              )}
            </div>

            {messages.map((message) =>
              message.role === 'user' ? (
                <div
                  key={message.id}
                  className="self-end max-w-[92%] rounded-[12px] rounded-se-[4px] bg-newAccent/90 text-[#06222e] px-[12px] py-[8px] whitespace-pre-wrap break-words"
                >
                  {message.content}
                </div>
              ) : (
                <div
                  key={message.id}
                  className="self-start w-[96%] flex flex-col items-start gap-[8px]"
                >
                  {message.content && (
                    <div
                      className={clsx(
                        'rounded-[12px] rounded-ss-[4px] px-[12px] py-[8px] whitespace-pre-wrap break-words',
                        message.error
                          ? 'bg-rose-500/15 border border-rose-500/40'
                          : 'bg-newColColor'
                      )}
                    >
                      {message.content}
                    </div>
                  )}
                  {message.posts?.map((post, index) => (
                    <div
                      key={index}
                      data-testid="assistant-draft"
                      className="self-stretch rounded-[12px] border border-newBorder bg-black/20 px-[12px] py-[10px] flex flex-col gap-[8px]"
                    >
                      <div className="whitespace-pre-wrap break-words">
                        {post}
                      </div>
                      <div className="flex items-center gap-2">
                        {!message.thread &&
                          renderUse(
                            `${message.id}:${index}`,
                            t('assistant_use_in_post', 'Use in post'),
                            () => putPost(composer, post, () => makeId(10))
                          )}
                        <span className="ms-auto text-[11px] text-newTextColor/50">
                          {t('assistant_chars', '{{n}} characters', {
                            n: post.length,
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                  {message.thread && message.posts && (
                    <div>
                      {renderUse(
                        `${message.id}:thread`,
                        t('assistant_use_thread', 'Use as thread'),
                        () =>
                          putThread(composer, message.posts!, () => makeId(10))
                      )}
                    </div>
                  )}
                </div>
              )
            )}

            {busy && (
              <div className="self-start rounded-[12px] rounded-ss-[4px] bg-newColColor px-[12px] py-[8px] text-newTextColor/60">
                {t('assistant_writing', 'Writing…')}
              </div>
            )}
          </div>

          <form
            onSubmit={send}
            className="shrink-0 border-t border-newBorder p-[10px] flex items-end gap-[8px]"
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={onKeyDown}
              rows={2}
              maxLength={CHAT_MAX_MESSAGE}
              aria-label={t('assistant_input_label', 'Message to the assistant')}
              placeholder={t(
                'assistant_placeholder',
                'Write a post about…'
              )}
              className="flex-1 resize-none rounded-[10px] bg-newColColor border border-newBorder px-[10px] py-[8px] text-[13px] outline-none focus:border-newAccent placeholder:text-newTextColor/40"
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className="h-[36px] px-[14px] rounded-[10px] bg-newAccent text-[#06222e] text-[13px] font-[600] hover:bg-forth transition-colors disabled:opacity-50"
            >
              {t('assistant_send', 'Send')}
            </button>
          </form>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={
          open
            ? t('assistant_close', 'Close the assistant')
            : t('assistant_open', 'Open the AI assistant')
        }
        className="pointer-events-auto relative w-[56px] h-[56px] phone:w-[44px] phone:h-[44px] rounded-full bg-newAccent text-[#06222e] shadow-xl flex items-center justify-center hover:bg-forth transition-colors"
      >
        {!open && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-newAccent opacity-60 animate-ping motion-reduce:hidden [animation-duration:2.2s]"
          />
        )}
        <svg
          className="relative"
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          {open ? (
            <path d="M6 6l12 12M18 6L6 18" />
          ) : (
            <>
              <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 8.9 8.9 0 0 1-3.8-.9L3 20.5l1.7-4.9A8.1 8.1 0 0 1 4 11.5 8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z" />
              <path d="M12.5 8.2l.9 2.2 2.2.9-2.2.9-.9 2.2-.9-2.2-2.2-.9 2.2-.9z" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
};
