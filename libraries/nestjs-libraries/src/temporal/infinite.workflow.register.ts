import { Global, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { TemporalService } from 'nestjs-temporal-core';

@Injectable()
export class InfiniteWorkflowRegister implements OnModuleInit {
  constructor(private _temporalService: TemporalService) {}

  async onModuleInit(): Promise<void> {
    if (!!process.env.RUN_CRON) {
      // Each start is separate: a workflow already running answers with an
      // error, which must not keep the next one from starting.
      for (const [name, workflowId] of [
        ['missingPostWorkflow', 'missing-post-workflow'],
        ['housekeepingWorkflow', 'housekeeping-workflow'],
      ]) {
        try {
          await this._temporalService.client
            ?.getRawClient()
            ?.workflow?.start(name, { workflowId, taskQueue: 'main' });
        } catch (err) {}
      }
    }
  }
}

@Global()
@Module({
  imports: [],
  controllers: [],
  providers: [InfiniteWorkflowRegister],
  get exports() {
    return this.providers;
  },
})
export class InfiniteWorkflowRegisterModule {}
