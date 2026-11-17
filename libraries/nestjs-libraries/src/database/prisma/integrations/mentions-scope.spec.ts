import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';

// The mention suggestions were cached per platform for every organisation at
// once: one organisation's Discord server members showed up in another's
// composer, and a fake Bluesky server could plant a name for everybody.
// Each organisation now reads and writes only its own suggestions.
describe('mention suggestions belong to one organisation', () => {
  const build = () => {
    const rows: { platform: string; name: string; username: string; image: string }[] = [];
    const mentions = {
      createMany: jest.fn(async ({ data }: any) => {
        rows.push(...data);
        return { count: data.length };
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        rows
          .filter((r) => r.platform === where.platform)
          .filter((r) =>
            where.OR.some((c: any) => {
              const [field] = Object.keys(c);
              return r[field as 'name'].toLowerCase().includes(c[field].contains.toLowerCase());
            })
          )
          .slice(0, take)
      ),
    };
    const repository = new IntegrationRepository(
      {} as any, {} as any, {} as any, {} as any, {} as any,
      { model: { mentions } } as any
    );
    return { repository, mentions };
  };

  it('does not show one organisation what another one looked up', async () => {
    const { repository } = build();
    await repository.insertMentions('org-a', 'discord', [
      { name: 'Private member', username: '123', image: '' },
    ]);
    expect(await repository.getMentions('org-b', 'discord', 'private')).toEqual([]);
    expect(await repository.getMentions('org-a', 'discord', 'private')).toHaveLength(1);
  });

  it('stores a bounded number of rows from one lookup', async () => {
    const { repository, mentions } = build();
    const many = Array.from({ length: 500 }, (_, i) => ({
      name: `n${i}`,
      username: `u${i}`,
      image: '',
    }));
    await repository.insertMentions('org-a', 'bluesky', many);
    expect(mentions.createMany.mock.calls[0][0].data.length).toBeLessThanOrEqual(50);
  });
});
