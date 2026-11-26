import { Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { shutdownTracing } from './initialize.tracing';

// The last spans of a process leave with it: Nest calls this after the HTTP
// server has closed, on a signal (shutdown hooks) or on app.close().
@Injectable()
export class TracingShutdown implements OnApplicationShutdown {
  async onApplicationShutdown() {
    await shutdownTracing();
  }
}

@Module({ providers: [TracingShutdown] })
export class TracingModule {}
