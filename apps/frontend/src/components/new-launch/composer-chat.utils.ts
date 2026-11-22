import { aiPlainText, aiTextToHtml } from '@gitroom/frontend/components/new-launch/ai-text.utils';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** What the assistant wrote for the post, when it wrote something. */
  posts?: string[];
  /** The posts are parts of one thread rather than variants to pick from. */
  thread?: boolean;
  /** Something went wrong; shown in the chat, never sent back to the model. */
  error?: boolean;
}

export interface ComposerValue {
  id: string;
  content: string;
  delay: number;
  media: { id: string; path: string; thumbnail?: string }[];
}

// Same caps as AiChatDto: past them the server answers 400 for the whole
// conversation, so the oldest turns go first.
export const CHAT_MAX_MESSAGES = 20;
export const CHAT_MAX_MESSAGE = 6000;
export const CHAT_MAX_POSTS = 10;
export const CHAT_MAX_POST = 5000;

/**
 * The conversation as the model should read it: its own drafts included, so
 * "make the second one shorter" has something to point at, and none of the
 * failures the user saw in between.
 */
export const chatPayload = (
  messages: ChatMessage[],
  composer: ComposerValue[],
  platform?: string
) => {
  const turns = messages
    .filter((message) => !message.error)
    .map((message) => ({
      role: message.role,
      content: [message.content, ...(message.posts ?? [])]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, CHAT_MAX_MESSAGE),
    }))
    .filter((turn) => turn.content);

  // The window has to open on something the user said.
  let recent = turns.slice(-CHAT_MAX_MESSAGES);
  while (recent.length && recent[0].role !== 'user') recent = recent.slice(1);

  return {
    messages: recent,
    posts: composer
      .slice(0, CHAT_MAX_POSTS)
      .map((post) => aiPlainText(post?.content ?? '').slice(0, CHAT_MAX_POST)),
    ...(platform ? { platform } : {}),
  };
};

/**
 * Whether the composer still holds exactly what the chat put there. Undo is
 * only honest while it does: after the user has typed, added a picture or a
 * post, putting the old posts back would throw that work away with it.
 * Compared as text, because the editor hands the same words back with its own
 * markup.
 */
export const sameComposer = (a: ComposerValue[], b: ComposerValue[]) =>
  a.length === b.length &&
  a.every((post, index) => {
    const other = b[index];
    return (
      aiPlainText(post?.content ?? '') === aiPlainText(other?.content ?? '') &&
      (post?.delay ?? 0) === (other?.delay ?? 0) &&
      (post?.media ?? []).map((m) => m.id).join() ===
        (other?.media ?? []).map((m) => m.id).join()
    );
  });

// The conversation lives in the composer and ends with it. A reload of the
// page is the one ending nobody chose: it took every draft that had not been
// put in the post yet. So the conversation is kept in the tab's own storage
// while the composer is open, and thrown away when the composer closes; only
// a reload (or a crash) finds it still there. It never leaves the browser.
export const CHAT_KEPT_FOR_MS = 2 * 60 * 60 * 1000;

/** One conversation per person, organisation and post ('new' for a new one). */
// The post is part of the key: opening another post first (an empty chat
// there) must not wipe the conversation kept for this one.
export const chatStorageKey = (userId: string, orgId: string, scope: string) =>
  `postra:composer-chat:${userId}:${orgId}:${scope}`;

export const keepChat = (
  messages: ChatMessage[],
  scope: string,
  now: number
): string =>
  JSON.stringify({
    at: now,
    scope,
    messages: messages.slice(-CHAT_MAX_MESSAGES * 2),
  });

/**
 * What was kept, if it is this post's conversation, recent, and still shaped
 * like one. Storage is the user's to edit, so nothing in it is trusted.
 */
export const keptChat = (
  raw: string | null | undefined,
  scope: string,
  now: number
): ChatMessage[] => {
  if (!raw) return [];
  try {
    const kept = JSON.parse(raw) as {
      at?: unknown;
      scope?: unknown;
      messages?: unknown;
    };
    if (
      typeof kept?.at !== 'number' ||
      kept.at > now ||
      now - kept.at > CHAT_KEPT_FOR_MS ||
      kept.scope !== scope ||
      !Array.isArray(kept.messages)
    ) {
      return [];
    }
    const messages: ChatMessage[] = [];
    for (const item of kept.messages as Record<string, unknown>[]) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        (item.role !== 'user' && item.role !== 'assistant') ||
        typeof item.content !== 'string'
      ) {
        return [];
      }
      const posts = Array.isArray(item.posts)
        ? item.posts.filter((p): p is string => typeof p === 'string')
        : undefined;
      messages.push({
        id: item.id,
        role: item.role,
        content: item.content.slice(0, CHAT_MAX_MESSAGE),
        ...(posts?.length
          ? { posts: posts.slice(0, CHAT_MAX_POSTS), thread: item.thread === true && posts.length > 1 }
          : {}),
        ...(item.error === true ? { error: true } : {}),
      });
    }
    return messages;
  } catch {
    return [];
  }
};

const blank = (id: string): ComposerValue => ({
  id,
  content: '',
  delay: 0,
  media: [],
});

/**
 * One draft into the composer: the first post's text changes, its media, its
 * delay and every post after it stay as they are.
 */
export const putPost = (
  composer: ComposerValue[],
  text: string,
  makeId: () => string
): ComposerValue[] => {
  const [first, ...rest] = composer.length ? composer : [blank(makeId())];
  return [{ ...first, content: aiTextToHtml(text) }, ...rest];
};

/**
 * A thread replaces the thread. Media and delays stay with their position;
 * posts beyond the new length go, which is why the caller keeps what was
 * there for Undo.
 */
export const putThread = (
  composer: ComposerValue[],
  texts: string[],
  makeId: () => string
): ComposerValue[] =>
  texts.map((text, index) => ({
    ...(composer[index] ?? blank(makeId())),
    content: aiTextToHtml(text),
  }));
