import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { ConfigurationTask } from './tasks/configuration';
import { EncryptTokens } from './tasks/encrypt.tokens';
import { GrandfatherSubscriptions } from './tasks/grandfather.subscriptions';
import { GrantLifetime } from './tasks/grant.lifetime';
import { SyncChannelSlots } from './tasks/sync.channel.slots';
import { BackfillGrantedScopes } from './tasks/backfill.granted.scopes';
import { BackfillMediaType } from './tasks/backfill.media.type';
import { AgentModule } from '@gitroom/nestjs-libraries/agent/agent.module';
import { TemporalStubModule } from './temporal.stub.module';

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
    GrandfatherSubscriptions,
    GrantLifetime,
    SyncChannelSlots,
    BackfillGrantedScopes,
    BackfillMediaType,
  ],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
