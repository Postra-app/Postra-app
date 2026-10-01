import { APIRequestContext, expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';

// Webhooks call a URL the customer types, so two things matter: the URL
// cannot point into our network, and one organisation cannot touch
// another's webhooks.

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

let a: APIRequestContext;
let b: APIRequestContext;
test.beforeAll(async () => {
  a = await signedIn('a');
  b = await signedIn('b');
});
test.afterAll(async () => {
  await a.dispose();
  await b.dispose();
});

const webhook = (url: string) => ({
  name: `stack-${Date.now()}`,
  url,
  integrations: [{ id: channelOf('a') }],
});

test('a webhook to an address inside our network is refused', async () => {
  for (const url of [
    'http://localhost:53000/monitor/queue/main',
    'http://127.0.0.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
  ]) {
    expect((await a.post('/webhooks', { data: webhook(url) })).status(), url).toBe(400);
  }
});

test('the "send test" button will not call an address inside our network', async () => {
  const res = await a.post(
    `/webhooks/send?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`,
    { data: { test: true } }
  );
  expect(res.status()).toBeLessThan(500);
  if (res.status() === 201 || res.status() === 200) {
    expect(await res.json()).toMatchObject({ send: false });
  }
});

test('a webhook is created, renamed and deleted; unknown ids are 404', async () => {
  const created = await a.post('/webhooks', {
    data: webhook('https://example.com/hooks/stack'),
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();

  const renamed = await a.put('/webhooks', {
    data: { id, name: 'renamed', url: 'https://example.com/hooks/stack-2', integrations: [] },
  });
  expect(renamed.status()).toBe(200);

  expect((await a.delete(`/webhooks/${id}`)).status()).toBe(200);
  expect((await a.delete(`/webhooks/${id}`)).status()).toBe(404);
  expect((await a.delete(`/webhooks/${UNKNOWN}`)).status()).toBe(404);
});

test("B cannot see, change or delete A's webhook", async () => {
  const created = await a.post('/webhooks', {
    data: webhook('https://example.com/hooks/private'),
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();

  expect(JSON.stringify(await (await b.get('/webhooks')).json())).not.toContain(id);
  expect(
    (
      await b.put('/webhooks', {
        data: { id, name: 'taken', url: 'https://example.com/taken', integrations: [] },
      })
    ).status()
  ).toBe(404);
  expect((await b.delete(`/webhooks/${id}`)).status()).toBe(404);

  const mine = JSON.stringify(await (await a.get('/webhooks')).json());
  expect(mine).toContain('https://example.com/hooks/private');
  expect((await a.delete(`/webhooks/${id}`)).status()).toBe(200);
});
