import * as Sentry from '@sentry/nestjs';
import { initializeSentry } from './initialize.sentry';
import { SENTRY_DATA_COLLECTION } from '@gitroom/helpers/utils/sentry.data.collection';

// Sentry 11 collects user info, cookies, bodies and query parameters unless
// `dataCollection` says otherwise; the backend must start with ours, and
// without the options 11 removed (they would be ignored without a word).
it('starts the backend SDK with our data collection and no removed options', () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://public@127.0.0.1:9/1';
  expect(initializeSentry('backend')).toBe(true);
  const options = Sentry.getClient()!.getOptions() as Record<string, any>;
  expect(options.dataCollection).toEqual(SENTRY_DATA_COLLECTION);
  expect(options.dataCollection.cookies).toBe(false);
  expect(options.dataCollection.httpBodies).toEqual([]);
  expect(options.dataCollection.databaseQueryData).toBe(false);
  expect(options).not.toHaveProperty('enableLogs');
  expect(options).not.toHaveProperty('sendDefaultPii');
  expect(options.initialScope.attributes).toEqual({ service: 'backend', component: 'nestjs' });
});
