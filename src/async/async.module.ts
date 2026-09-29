import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { SchedulerService } from './scheduler.service';
import { RealtimeService } from './realtime.service';

@Global()
@Module({
  providers: [QueueService, SchedulerService, RealtimeService],
  exports: [QueueService, SchedulerService, RealtimeService],
})
export class AsyncModule {}
