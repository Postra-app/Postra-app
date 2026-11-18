import 'reflect-metadata';
import { PostFactsReader } from '@gitroom/nestjs-libraries/chat/post-facts.reader';
import { PendingActionService } from '@gitroom/nestjs-libraries/chat/pending-action.service';
import { DeletePostTool } from '@gitroom/nestjs-libraries/chat/tools/delete.post.tool';
import { ReschedulePostTool } from '@gitroom/nestjs-libraries/chat/tools/reschedule.post.tool';

const contextFor = (organizationId: string) => ({
  requestContext: {
    get: () => JSON.stringify({ id: organizationId }),
    set: () => undefined,
  },
});

describe('PendingActionService', () => {
  const service = new PendingActionService();

  it('hands back the action once and only once', async () => {
    const { token } = await service.create({
      kind: 'deletePost',
      organizationId: 'org-1',
      summary: 'the LinkedIn post scheduled for Friday',
      payload: { group: 'group-1' },
    });

    const first = await service.consume(token, 'org-1');
    expect(first?.payload.group).toEqual('group-1');

    // Two clicks on the same card must not delete twice.
    expect(await service.consume(token, 'org-1')).toBeNull();
  });

  it('ignores a token belonging to another organisation, and leaves it usable', async () => {
    const { token } = await service.create({
      kind: 'deletePost',
      organizationId: 'org-1',
      summary: 'a post',
      payload: { group: 'group-2' },
    });

    expect(await service.consume(token, 'org-2')).toBeNull();
    // The wrong click must not burn the owner's confirmation.
    expect((await service.consume(token, 'org-1'))?.payload.group).toEqual(
      'group-2'
    );
  });

  it('reports an unknown token as nothing pending', async () => {
    expect(await service.consume('not-a-token', 'org-1')).toBeNull();
  });
});

describe('destructive agent tools', () => {
  it('deletePost parks the deletion instead of doing it', async () => {
    const service = new PendingActionService();
    const facts = {
      byGroup: jest.fn().mockResolvedValue([
        {
          publishDate: new Date('2026-10-02T10:00:00Z'),
          content: 'Friday post',
          integration: { name: 'Acme', providerIdentifier: 'x' },
        },
      ]),
    };
    const tool = new DeletePostTool(service, facts as any).run();

    const output = (await (tool as any).execute(
      { group: 'group-9', summary: 'delete the Friday post' },
      contextFor('org-7')
    )) as { status: string; token: string; summary: string };

    expect(output.status).toEqual('awaiting_confirmation');
    expect(output.summary).toEqual(
      'Delete the post on x "Acme" scheduled for 2026-10-02 10:00 UTC: "Friday post"'
    );

    // Nothing is deleted yet - the parked action still holds the group id.
    const parked = await service.consume(output.token, 'org-7');
    expect(parked).toEqual(
      expect.objectContaining({
        kind: 'deletePost',
        organizationId: 'org-7',
        payload: { group: 'group-9' },
      })
    );
  });

  it('reschedulePost parks the new date instead of moving the post', async () => {
    const service = new PendingActionService();
    const facts = {
      byId: jest.fn().mockResolvedValue({
        publishDate: new Date('2026-09-30T09:00:00Z'),
        content: 'Thursday post',
        integration: { name: 'Acme', providerIdentifier: 'x' },
      }),
    };
    const tool = new ReschedulePostTool(service, facts as any).run();

    const output = (await (tool as any).execute(
      {
        id: 'post-3',
        date: '2026-10-01T09:00:00.000Z',
        summary: 'move it to Thursday 09:00',
      },
      contextFor('org-7')
    )) as { status: string; token: string };

    expect(output.status).toEqual('awaiting_confirmation');
    expect((await service.consume(output.token, 'org-7'))?.payload).toEqual({
      id: 'post-3',
      date: '2026-10-01T09:00:00.000Z',
    });
  });

  it('takes no constructor dependency that could delete a post on its own', () => {
    // The tools used to hold PostsService. If that comes back, the gate is a
    // prompt again rather than a control. Besides the parking service they
    // hold only the read-only reader the card text comes from.
    const allowed = [PendingActionService, PostFactsReader];
    for (const tool of [DeletePostTool, ReschedulePostTool]) {
      const deps: unknown[] =
        Reflect.getMetadata('design:paramtypes', tool) ?? [];
      expect(deps).toEqual(allowed);
    }
    const reader = Object.getOwnPropertyNames(PostFactsReader.prototype);
    expect(reader.sort()).toEqual(['byGroup', 'byId', 'constructor']);
  });
});
