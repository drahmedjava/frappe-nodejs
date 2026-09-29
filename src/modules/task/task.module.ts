import { Module, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { FrappeFeatureService } from '../../core/frappe-feature.service';
import { TaskCustomController } from './task.controller';
import { TaskEventsService } from './task.events';
import { TASK_VIEWS } from './task.views';
import { TaskDocument } from './task.document';

@Module({
  controllers: [TaskCustomController],
  providers: [TaskEventsService],
  exports: [TaskEventsService],
})
export class TaskModule implements OnModuleInit {
  constructor(private readonly featureService: FrappeFeatureService) {}

  async onModuleInit() {
    await this.featureService.registerFeature({
      moduleName: 'Projects',
      doctypesPath: path.join(__dirname, 'doctypes'),
      documentController: {
        doctype: 'Task',
        controllerClass: TaskDocument,
      },
      views: TASK_VIEWS,
    });
  }
}
