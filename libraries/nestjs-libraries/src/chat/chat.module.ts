import { PostFactsReader } from '@gitroom/nestjs-libraries/chat/post-facts.reader';
import { Global, Module } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { PendingActionService } from '@gitroom/nestjs-libraries/chat/pending-action.service';

@Global()
@Module({
  providers: [
    MastraService,
    LoadToolsService,
    PendingActionService,
    PostFactsReader,
    ...toolList,
  ],
  get exports() {
    return this.providers;
  },
})
export class ChatModule {}
