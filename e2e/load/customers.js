// k6: N customers at once, each in their own organisation (seed.mjs), doing
// what a customer does all day — open the calendar, look at their channels,
// find a free slot, save a draft — with a few seconds of thinking between.
// Plan I3 (Plan/lunchdayfinal.md §12.2): 50 / 100 / 200 at once, on staging.
//
//   k6 run -e BACKEND_URL=http://localhost:53000 -e VUS=50 e2e/load/customers.js
//
// Drafts are not published (no platform is touched) and stay until
// `node e2e/load/seed.mjs --remove`, which deletes the organisations.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const BASE = __ENV.BACKEND_URL || 'http://localhost:53000';
const VUS = Number(__ENV.VUS || 50);
const users = new SharedArray('users', () => JSON.parse(open('./users.json')));

export const options = {
  scenarios: {
    customers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '1m', target: VUS },
        { duration: __ENV.HOLD || '3m', target: VUS },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '10s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<800'],
    'http_req_duration{kind:write}': ['p(95)<1500'],
  },
};

export function setup() {
  if (users.length < VUS) {
    throw new Error(`users.json has ${users.length} users, the run needs ${VUS}`);
  }
}

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toISOString();
};

export default function () {
  const user = users[(__VU - 1) % users.length];
  const headers = { auth: user.auth, 'content-type': 'application/json' };
  const read = (name) => ({ headers, tags: { kind: 'read', name } });

  const calendar = http.get(`${BASE}/posts?startDate=${day(-3)}&endDate=${day(4)}`, read('calendar'));
  check(calendar, { 'calendar 200': (r) => r.status === 200 });
  sleep(1 + Math.random() * 2);

  check(http.get(`${BASE}/integrations/list`, read('channels')), {
    'channels 200': (r) => r.status === 200,
  });
  check(http.get(`${BASE}/posts/find-slot`, read('find-slot')), {
    'find-slot 200': (r) => r.status === 200,
  });
  sleep(2 + Math.random() * 4);

  const draft = http.post(
    `${BASE}/posts`,
    JSON.stringify({
      type: 'draft',
      shortLink: false,
      date: day(2),
      tags: [],
      posts: [
        {
          type: 'draft',
          integration: { id: user.channel },
          value: [{ content: `Load test draft ${__VU}-${__ITER}`, image: [] }],
          settings: { __type: 'bluesky' },
        },
      ],
    }),
    { headers, tags: { kind: 'write', name: 'save-draft' } }
  );
  check(draft, { 'draft 201': (r) => r.status === 201 });
  sleep(3 + Math.random() * 5);
}
