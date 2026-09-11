import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { ConfigurationTask } from './tasks/configuration';
import { EncryptTokens } from './tasks/encrypt.tokens';
import { GrantLifetime } from './tasks/grant.lifetime';
import { SyncChannelSlots } from './tasks/sync.channel.slots';
import { BackfillGrantedScopes } from './tasks/backfill.granted.scopes';
import { BackfillMediaType } from './tasks/backfill.media.type';
import { ScrubErrorSecrets } from './tasks/scrub.error.secrets';
import { PurgeOldRecords } from './tasks/purge.old.records';
import { AgentModule } from '@gitroom/nestjs-libraries/agent/agent.module';
import { TemporalStubModule } from './temporal.stub.module';

// grandfather-subscriptions is deliberately NOT registered here.
//
// It was a one-off backfill run before Stripe billing was switched on, so that
// no existing organization dropped to FREE. It has done its job. Left
// registered, one flag would write ULTIMATE, isLifetime and a hundred channels
// onto *every* organization whose subscription is empty or soft-deleted —
// which after launch means the entire free tier, permanently, with no product
// path to undo it (E2E-09-41, E2E-09-42). Run once, from a stale runbook or
// the wrong container, and the only way back is the database.
//
// The command file is kept for the record; re-register it only for another
// deliberate backfill, and read grandfatherAllOrganizations first.

@Module({
  // DatabaseModule's services (notification / posts / autopost / integration)
  // inject TemporalService, so the CLI app won't bootstrap without a provider
  // for it. Wiring the real TemporalModule makes the CLI hang connecting to a
  // Temporal server, and commands never touch Temporal — so provide a global
  // no-op TemporalService via TemporalStubModule instead.
  imports: [
    ExternalCommandModule,
    DatabaseModule,
    AgentModule,
    TemporalStubModule,
  ],
  controllers: [],
  providers: [
    RefreshTokens,
    ConfigurationTask,
    EncryptTokens,
    GrantLifetime,
    SyncChannelSlots,
    BackfillGrantedScopes,
    BackfillMediaType,
    ScrubErrorSecrets,
    PurgeOldRecords,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
