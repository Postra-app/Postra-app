import { expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';

// Channel settings over the API.

test('posting times: an unknown or foreign channel is 404, not 500', async () => {
  const a = await signedIn('a');
  const data = { time: [{ time: 600 }] };
  expect(
    (await a.post('/integrations/00000000-0000-4000-8000-000000000000/time', { data })).status()
  ).toBe(404);
  expect((await a.post(`/integrations/${channelOf('b')}/time`, { data })).status()).toBe(404);
  await a.dispose();
});

test('posting times are kept within one day', async () => {
  // 00:30 in London in summer reached the server as -30 minutes.
  const a = await signedIn('a');
  const id = channelOf('a');
  const list = async () =>
    (await (await a.get('/integrations/list')).json()).integrations.find(
      (i: { id: string }) => i.id === id
    ).time;
  const original = await list();

  const res = await a.post(`/integrations/${id}/time`, {
    data: { time: [{ time: -30 }, { time: 1500 }, { time: 600 }] },
  });
  expect(res.status()).toBe(201);
  expect(await list()).toEqual([{ time: 1410 }, { time: 60 }, { time: 600 }]);

  await a.post(`/integrations/${id}/time`, { data: { time: original } });
  await a.dispose();
});
