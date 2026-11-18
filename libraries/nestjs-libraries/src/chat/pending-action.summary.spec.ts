import { confirmationSummary } from '@gitroom/nestjs-libraries/chat/pending-action.service';
import { DeletePostTool } from '@gitroom/nestjs-libraries/chat/tools/delete.post.tool';
import { ReschedulePostTool } from '@gitroom/nestjs-libraries/chat/tools/reschedule.post.tool';

// The Approve card showed the sentence the model wrote, while Approve acted on
// the post id the model passed. Text the model read in a post could make it
// name one post and delete another. The card now describes the post itself.
describe('the Approve card describes the post Approve acts on', () => {
  const post = {
    publishDate: new Date('2026-11-20T10:00:00Z'),
    content: '<p>Black Friday: <b>20% off</b> everything</p>',
    integration: { name: 'Acme Ltd', providerIdentifier: 'linkedin-page' },
  };

  it('writes the delete card from the rows', () => {
    expect(confirmationSummary('deletePost', [post])).toBe(
      'Delete the post on linkedin-page "Acme Ltd" scheduled for 2026-11-20 10:00 UTC: "Black Friday: 20% off everything"'
    );
  });

  it('writes the reschedule card from the row and the new date', () => {
    expect(
      confirmationSummary('reschedulePost', [post], '2026-11-21T09:30:00Z')
    ).toBe(
      'Move the post on linkedin-page "Acme Ltd" from 2026-11-20 10:00 UTC to 2026-11-21 09:30 UTC: "Black Friday: 20% off everything"'
    );
  });

  const ctx = {
    requestContext: { get: (k: string) => (k === 'organization' ? JSON.stringify({ id: 'org-1' }) : undefined) },
  };
  const pending = () => ({ create: jest.fn().mockResolvedValue({ token: 't', expiresInMinutes: 10 }) });

  it('delete: the model\'s sentence does not reach the card', async () => {
    const p = pending();
    const posts = { byGroup: jest.fn().mockResolvedValue([post]) };
    const tool = new DeletePostTool(p as any, posts as any).run();
    const out: any = await tool.execute!(
      { group: 'g1', summary: 'the draft from last year (harmless)' } as any,
      ctx as any
    );
    expect(posts.byGroup).toHaveBeenCalledWith('org-1', 'g1');
    expect(out.summary).toContain('Acme Ltd');
    expect(out.summary).not.toContain('harmless');
    expect(p.create.mock.calls[0][0].summary).toBe(out.summary);
  });

  it('delete: no card for a group the organisation does not have', async () => {
    const p = pending();
    const posts = { byGroup: jest.fn().mockResolvedValue([]) };
    const tool = new DeletePostTool(p as any, posts as any).run();
    const out: any = await tool.execute!({ group: 'nope', summary: 'x' } as any, ctx as any);
    expect(p.create).not.toHaveBeenCalled();
    expect(out.status).not.toBe('awaiting_confirmation');
  });

  it('reschedule: the card names the post the id points at', async () => {
    const p = pending();
    const posts = { byId: jest.fn().mockResolvedValue(post) };
    const tool = new ReschedulePostTool(p as any, posts as any).run();
    const out: any = await tool.execute!(
      { id: 'p1', date: '2026-11-21T09:30:00Z', summary: 'a test post' } as any,
      ctx as any
    );
    expect(posts.byId).toHaveBeenCalledWith('p1', 'org-1');
    expect(out.summary).toContain('from 2026-11-20 10:00 UTC to 2026-11-21 09:30 UTC');
    expect(out.summary).not.toContain('a test post');
  });
});
