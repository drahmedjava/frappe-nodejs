import { Controller } from '@nestjs/common';
import { BaseCustomController } from '../../api/base-custom.controller';
import { Whitelist } from '../../api/decorators/whitelist.decorator';
import { DocumentService } from '../../document/document.service';

@Controller('api/method/task')
export class TaskCustomController extends BaseCustomController {
  constructor(docService: DocumentService) {
    super(docService);
  }

  @Whitelist({ name: 'task.batch_complete', isPublic: true })
  async batch_complete(params: { task_ids: string[] }) {
    const ids = params.task_ids || [];
    for (const id of ids) {
      const doc = await this.getDoc('Task', id);
      doc.set('status', 'Completed');
      doc.set('is_completed', 1);
      await doc.save();
    }
    return { ok: true, completed_count: ids.length };
  }

  @Whitelist({ name: 'task.get_task_metrics', isPublic: true })
  async get_task_metrics() {
    const tasks = await this.getList('Task', { limit: 100 });
    const completed = tasks.filter((t: any) => t.status === 'Completed' || t.is_completed === 1).length;
    return {
      total: tasks.length,
      completed,
      pending: tasks.length - completed,
    };
  }
}
