jest.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({ pStore: {} }));
jest.mock('@mastra/core/mastra', () => ({ Mastra: class {} }));
jest.mock('@mastra/core/logger', () => ({ ConsoleLogger: class {} }));
jest.mock('@gitroom/nestjs-libraries/chat/load.tools.service', () => ({ LoadToolsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/prisma.service', () => ({ PrismaService: class {} }));

import { MastraService } from './mastra.service';

// Postgres counts dropped columns toward its 1600-column cap. Mastra's init
// churns columns on startup; at the cap the backend crash-looped (2026-05-31,
// 2026-07-04). Measured on production 2026-10-16: mastra_ai_spans 332
// physical / 46 live, mastra_scorers 245 / 38 - both empty, both unused. The
// guard covered only the spans table.
describe('MastraService bloat guard', () => {
  const run = async (columns: Record<string, number>) => {
    const executed: string[] = [];
    const prisma = {
      $queryRawUnsafe: jest.fn(async (_sql: string, table: string) => [
        { columns: columns[table] ?? 0 },
      ]),
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        executed.push(sql);
        return 0;
      }),
    };
    const service = new MastraService({ agent: async () => ({}) } as any, prisma as any);
    await (service as any).resetObservabilityTableIfBloated();
    return executed.filter((s) => s.startsWith('DROP'));
  };

  it('drops a bloated scorers table too', async () => {
    expect(await run({ mastra_scorers: 1200 })).toEqual([
      'DROP TABLE IF EXISTS mastra_scorers CASCADE',
    ]);
  });

  it('drops a bloated spans table', async () => {
    expect(await run({ mastra_ai_spans: 1000 })).toEqual([
      'DROP TABLE IF EXISTS mastra_ai_spans CASCADE',
    ]);
  });

  it('leaves healthy tables alone', async () => {
    expect(await run({ mastra_ai_spans: 332, mastra_scorers: 245 })).toEqual([]);
  });
});
