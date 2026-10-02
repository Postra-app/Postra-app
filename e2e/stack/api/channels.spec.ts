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

test('customers: a channel cannot join another organisation’s customer', async () => {
  const a = await signedIn('a');
  const b = await signedIn('b');
  await a.put(`/integrations/${channelOf('a')}/customer-name`, {
    data: { name: 'Private client of A' },
  });
  const customers = await (await a.get('/integrations/customers')).json();
  const customerOfA = customers.find((c: { name: string }) => c.name === 'Private client of A');
  expect(customerOfA).toBeTruthy();

  // B points its own channel at A's customer id.
  const res = await b.put(`/integrations/${channelOf('b')}/group`, {
    data: { group: customerOfA.id },
  });
  expect(res.status()).toBe(404);
  const listOfB = JSON.stringify(await (await b.get('/integrations/list')).json());
  expect(listOfB).not.toContain('Private client of A');

  await a.put(`/integrations/${channelOf('a')}/customer-name`, { data: { name: '' } });
  await a.dispose();
  await b.dispose();
});

test('customers: unknown or foreign channels are 404, and an emptied customer is not offered again', async () => {
  const a = await signedIn('a');
  const unknown = '00000000-0000-4000-8000-000000000000';
  expect(
    (await a.put(`/integrations/${unknown}/customer-name`, { data: { name: 'x' } })).status()
  ).toBe(404);
  expect(
    (await a.put(`/integrations/${channelOf('b')}/customer-name`, { data: { name: 'x' } })).status()
  ).toBe(404);
  expect((await a.put(`/integrations/${unknown}/group`, { data: { group: '' } })).status()).toBe(404);

  await a.put(`/integrations/${channelOf('a')}/customer-name`, { data: { name: 'Short-lived client' } });
  await a.put(`/integrations/${channelOf('a')}/customer-name`, { data: { name: '' } });
  const names = (await (await a.get('/integrations/customers')).json()).map((c: { name: string }) => c.name);
  expect(names).not.toContain('Short-lived client');
  await a.dispose();
});

test('U9: editing a channel never answers with its tokens', async () => {
  const a = await signedIn('a');
  const id = channelOf('a');
  const answers = [
    await a.put(`/integrations/${id}/customer-name`, { data: { name: 'Token check client' } }),
    await a.put(`/integrations/${id}/group`, { data: { group: '' } }),
    await a.put(`/integrations/${id}/customer-name`, { data: { name: '' } }),
  ];
  for (const res of answers) {
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(id);
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['token']));
    expect(Object.keys(body)).not.toContain('refreshToken');
    expect(Object.keys(body)).not.toContain('internalId');
  }
  await a.dispose();
});
