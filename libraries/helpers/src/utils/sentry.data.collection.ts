import type { DataCollection } from '@sentry/core';

// What Sentry may collect, for the backend, the orchestrator and the frontend
// alike. Sentry 11 replaced `sendDefaultPii` with `dataCollection` and, left
// unset, collects far more than 10 did: user info, cookies (our `auth` JWT),
// request and response bodies, database query parameters (customer data
// through Prisma), AI prompts and queue payloads. This keeps Sentry 10's
// default ("GDPR: never attach IP address / user identifiers"), taken from
// the migration guide's baseline, plus the credentials we carry in headers
// and an OAuth callback's `code`.
const NOT_PERSONAL = ['forwarded', '-ip', 'remote-', 'via', '-user'];

export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { deny: [...NOT_PERSONAL, 'cookie', 'authorization', 'auth'] },
    response: { deny: [...NOT_PERSONAL, 'set-cookie', 'auth'] },
  },
  httpBodies: [],
  urlQueryParams: { deny: [...NOT_PERSONAL, 'code'] },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  graphQL: { document: false, variables: false },
};
