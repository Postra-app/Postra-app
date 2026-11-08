import { MaintenanceService } from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';

// Files no row refers to at all (a replaced thumbnail, an upload never saved,
// a test file) stayed in the bucket for good: the media sweep only looks at
// media rows.
const removeFile = jest.fn(async (_path: string) => undefined);
const removeStored = jest.fn(async (item: { path: string }) => removeFile(item.path));
let stored: { key: string; path: string; lastModified: Date; size: number }[] = [];
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: () => ({
      removeFile,
      removeStored,
      async *listStored() {
        for (const item of stored) yield item;
      },
    }),
  },
}));

const DAY = 86_400_000;
const object = (key: string, ageDays: number, size = 100) => ({
  key,
  path: `https://cdn.example/${key}`,
  lastModified: new Date(Date.now() - ageDays * DAY),
  size,
});

// Every table as the text Postgres would give for its rows.
const service = (tables: Record<string, string[]>) => {
  const $queryRawUnsafe = jest.fn(async (sql: string) => {
    if (sql.includes('information_schema')) {
      return Object.keys(tables).map((t) => ({ t }));
    }
    const table = /FROM "([^"]+)"/.exec(sql)![1];
    const found = new Set<string>();
    for (const text of tables[table] ?? []) {
      for (const m of text.matchAll(/\d{4}(?:\/|%2[Ff])\d{2}(?:\/|%2[Ff])\d{2}(?:\/|%2[Ff])[A-Za-z0-9._-]+/g)) found.add(m[0]);
    }
    return [...found].map((k) => ({ k }));
  });
  return new MaintenanceService({ model: { $queryRawUnsafe } } as any);
};

beforeEach(() => {
  removeFile.mockClear();
  removeStored.mockClear();
  removeStored.mockImplementation(async (item: { path: string }) => removeFile(item.path));
  stored = [];
});

it('removes an old file no row mentions, and keeps the rest', async () => {
  stored = [
    object('2026/09/01/orphan.jpg', 60, 500),
    object('2026/09/01/inpost.jpg', 60),
    object('2026/09/01/encoded.jpg', 60),
    object('2026/11/08/fresh.jpg', 1),
    object('problem-reports/x.png', 90),
    ...Array.from({ length: 10 }, (_, i) => object(`2026/09/02/kept${i}.jpg`, 60)),
  ];
  const report = await service({
    Media: Array.from({ length: 10 }, (_, i) => `{"path":"https://cdn.example/2026/09/02/kept${i}.jpg"}`),
    Post: ['{"image":"[{\\"path\\":\\"https://cdn.example/2026/09/01/inpost.jpg\\"}]"}'],
    mastra_messages: ['see https://cdn.example/2026%2F09%2F01%2Fencoded.jpg'],
  }).sweepUnlistedObjects(true);
  expect(removeFile.mock.calls).toEqual([['https://cdn.example/2026/09/01/orphan.jpg']]);
  expect(report).toMatchObject({ listed: 14, old: 13, unreferenced: 1, removed: 1, bytes: 500, refused: false });
});

it('a dry run says what it would remove and removes nothing', async () => {
  stored = [object('2026/09/01/orphan.jpg', 60)];
  const report = await service({ Media: [] }).sweepUnlistedObjects(false);
  expect(report.unreferenced).toBe(1);
  expect(removeFile).not.toHaveBeenCalled();
});

it('refuses when too much looks unreferenced to be real (a broken scan)', async () => {
  stored = Array.from({ length: 80 }, (_, i) => object(`2026/09/01/f${i}.jpg`, 60));
  const report = await service({ Media: [] }).sweepUnlistedObjects(true);
  expect(report.refused).toBe(true);
  expect(removeFile).not.toHaveBeenCalled();
});

it('a removal the storage refuses is counted as failed, not removed', async () => {
  stored = [object('2026/09/01/a.jpg', 60, 10), object('2026/09/01/b.jpg', 60, 20)];
  removeStored.mockImplementationOnce(async () => {
    throw new Error('AccessDenied');
  });
  const report = await service({ Media: [] }).sweepUnlistedObjects(true);
  expect(report).toMatchObject({ removed: 1, failed: 1, bytes: 20 });
});
