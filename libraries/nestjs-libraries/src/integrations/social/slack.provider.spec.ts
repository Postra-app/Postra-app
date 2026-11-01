import { SlackProvider } from './slack.provider';
import { BadBody, RefreshToken } from '../social.abstract';

// Slack answers HTTP 200 with { ok: false, error } when a call fails. The
// provider read only `ts` and `permalink`, so a refused message was saved as
// published with an empty link, and a revoked install never asked for a
// reconnect.

const integration = { name: 'Postra', picture: 'https://cdn.example.com/p.png' } as any;
const post = (message: string) =>
  [{ id: 'p1', message, settings: { channel: 'C123' }, media: [] }] as any;

const slackAnswers = (answers: Record<string, object | object[]>) => {
  const calls: string[] = [];
  jest.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const url = String(input);
    const method = url.split('/api/')[1].split('?')[0];
    calls.push(url);
    const answer = answers[method];
    const body = Array.isArray(answer) ? answer.shift() : answer;
    return new Response(JSON.stringify(body ?? { ok: true }), { status: 200 });
  });
  return calls;
};

describe('SlackProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('publishes and keeps the message link', async () => {
    slackAnswers({
      'conversations.join': { ok: true },
      'chat.postMessage': { ok: true, ts: '1.2', channel: 'C123' },
      'chat.getPermalink': { ok: true, permalink: 'https://x.slack.com/archives/C123/p12' },
    });
    const [res] = await new SlackProvider().post('i', 't', post('Hello'), integration);
    expect(res).toMatchObject({ postId: '1.2', releaseURL: 'https://x.slack.com/archives/C123/p12' });
  });

  it('a refused message fails the post with the reason, not as published', async () => {
    slackAnswers({
      'conversations.join': { ok: false, error: 'method_not_supported_for_channel_type' },
      'chat.postMessage': { ok: false, error: 'not_in_channel' },
    });
    const err = await new SlackProvider().post('i', 't', post('Hello'), integration).catch((e) => e);
    expect(err).toBeInstanceOf(BadBody);
    expect(err.message).toContain('/invite @Postra');
  });

  it('a revoked install asks for a reconnect', async () => {
    slackAnswers({
      'conversations.join': { ok: false, error: 'token_revoked' },
    });
    const err = await new SlackProvider().post('i', 't', post('Hello'), integration).catch((e) => e);
    expect(err).toBeInstanceOf(RefreshToken);
  });

  it('lists every channel, following the cursor', async () => {
    const calls = slackAnswers({
      'conversations.list': [
        { ok: true, channels: [{ id: 'C1', name: 'one' }], response_metadata: { next_cursor: 'abc' } },
        { ok: true, channels: [{ id: 'C2', name: 'two' }], response_metadata: { next_cursor: '' } },
      ],
    });
    const list = await new SlackProvider().channels('t', {}, 'i');
    expect(list).toEqual([
      { id: 'C1', name: 'one' },
      { id: 'C2', name: 'two' },
    ]);
    expect(calls[1]).toContain('cursor=abc');
  });

  it('keeps a message within the 3,000 characters Slack takes in one section', () => {
    expect(new SlackProvider().maxLength()).toBe(3000);
  });
});
