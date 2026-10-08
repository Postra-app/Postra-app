jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class {},
}));

import 'reflect-metadata';
import { TemporalMetadataAccessor } from 'nestjs-temporal-core';
import { IntegrationsActivity } from './integrations.activity';

/**
 * Only methods carrying @ActivityMethod() reach the worker. refreshToken had
 * none, so refreshTokenWorkflow — the one that renews a token before it
 * expires — called an activity no worker served.
 */
it('the token refresh workflow can reach its activities', () => {
  const accessor = new (TemporalMetadataAccessor as any)();
  const { methods } = accessor.extractActivityMethods(
    new IntegrationsActivity({} as any, {} as any)
  );
  expect([...methods.keys()].sort()).toEqual(['getIntegrationsById', 'refreshToken']);
});

it('the housekeeping workflow can reach the margin guard', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { HousekeepingActivity } = require('./housekeeping.activity');
  const accessor = new (TemporalMetadataAccessor as any)();
  const { methods } = accessor.extractActivityMethods(
    new HousekeepingActivity({} as any, {} as any, {} as any, {} as any)
  );
  expect([...methods.keys()].sort()).toEqual(['checkAiMargins', 'purgeOldRecords']);
});
