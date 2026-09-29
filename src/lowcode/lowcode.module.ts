import { Global, Module } from '@nestjs/common';
import { ServerScriptService } from './server-script.service';
import { WorkflowService } from './workflow.service';
import { NotificationService } from './notification.service';

@Global()
@Module({
  providers: [ServerScriptService, WorkflowService, NotificationService],
  exports: [ServerScriptService, WorkflowService, NotificationService],
})
export class LowCodeModule {}
