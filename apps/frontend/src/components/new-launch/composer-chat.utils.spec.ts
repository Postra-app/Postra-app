import {
  ChatMessage,
  ComposerValue,
  chatPayload,
  putPost,
  putThread,
} from './composer-chat.utils';

const post = (id: string, content: string, media: ComposerValue['media'] = []): ComposerValue => ({
  id,
  content,
  delay: 5,
  media,
});
const picture = [{ id: 'm1', path: '/a.png' }];
let n = 0;
const makeId = () => `new-${++n}`;

// The chat it replaces had one action, which threw away every post in the
// composer and the pictures on all but the first positions, with no way back.
describe('putting a draft from the chat into the composer', () => {
  it('changes the text of the first post and nothing else', () => {
    const before = [post('a', '<p>old</p>', picture), post('b', '<p>second</p>')];
    const after = putPost(before, 'Tom & Co\nline two', makeId);
    expect(after).toEqual([
      { ...before[0], content: '<p>Tom &amp; Co</p><p>line two</p>' },
      before[1],
    ]);
    // what Undo puts back is untouched
    expect(before[0].content).toBe('<p>old</p>');
  });

  it('writes into an empty composer', () => {
    expect(putPost([], 'Hello', makeId)).toMatchObject([
      { content: '<p>Hello</p>', delay: 0, media: [] },
    ]);
  });

  it('a thread keeps media and delays by position and drops the posts beyond it', () => {
    const before = [post('a', '<p>1</p>', picture), post('b', '<p>2</p>'), post('c', '<p>3</p>')];
    const after = putThread(before, ['One', 'Two'], makeId);
    expect(after).toEqual([
      { ...before[0], content: '<p>One</p>' },
      { ...before[1], content: '<p>Two</p>' },
    ]);
  });

  it('a thread longer than the composer adds posts', () => {
    const after = putThread([post('a', '<p>1</p>')], ['One', 'Two'], makeId);
    expect(after).toHaveLength(2);
    expect(after[0].id).toBe('a');
    expect(after[1]).toMatchObject({ content: '<p>Two</p>', delay: 0, media: [] });
  });
});

describe('what the chat sends', () => {
  const say = (id: string, role: ChatMessage['role'], content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    id,
    role,
    content,
    ...extra,
  });

  it('sends the composer as text, the drafts with their turn, and no failures', () => {
    const payload = chatPayload(
      [
        say('1', 'user', 'Write a post'),
        say('2', 'assistant', 'Here it is.', { posts: ['Draft one'] }),
        say('3', 'user', 'Shorter'),
        say('4', 'assistant', 'AI is unavailable right now.', { error: true }),
        say('5', 'user', 'Shorter please'),
      ],
      [post('a', '<p>Tom &amp; Co</p><p>line two</p>')],
      'linkedin'
    );
    expect(payload).toEqual({
      messages: [
        { role: 'user', content: 'Write a post' },
        { role: 'assistant', content: 'Here it is.\n\nDraft one' },
        { role: 'user', content: 'Shorter' },
        { role: 'user', content: 'Shorter please' },
      ],
      posts: ['Tom & Co\nline two'],
      platform: 'linkedin',
    });
  });

  it('keeps a long conversation inside what the server accepts, starting with the user', () => {
    const long: ChatMessage[] = [];
    for (let i = 0; i < 15; i++) {
      long.push(say(`u${i}`, 'user', `question ${i}`));
      long.push(say(`a${i}`, 'assistant', `answer ${i}`));
    }
    long.push(say('last', 'user', 'x'.repeat(7000)));
    const { messages, platform } = chatPayload(long, []) as ReturnType<typeof chatPayload> & { platform?: string };
    expect(messages.length).toBeLessThanOrEqual(20);
    expect(messages[0].role).toBe('user');
    expect(messages[messages.length - 1].content).toHaveLength(6000);
    expect(platform).toBeUndefined();
  });
});
