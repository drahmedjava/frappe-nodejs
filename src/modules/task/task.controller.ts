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

  /**
   * Stateless effort estimator — no DB access.
   * Accepts task description and checklist count, returns story point estimate.
   * This showcases backend-only RPC methods that don't touch the database.
   */
  @Whitelist({ name: 'task.estimate_effort', isPublic: true })
  estimate_effort(params: { description?: string; checklist_count?: number }): {
    story_points: number;
    complexity: string;
    estimated_hours: number;
  } {
    const descLength = (params.description || '').length;
    const checklistCount = params.checklist_count ?? 0;

    // Heuristic: 1 point per 100 chars of description + 0.5 per checklist item
    const rawPoints = Math.ceil(descLength / 100) + Math.ceil(checklistCount * 0.5);
    const story_points = Math.min(Math.max(rawPoints, 1), 13); // Fibonacci-ish cap at 13

    let complexity: string;
    if (story_points <= 2) complexity = 'XS';
    else if (story_points <= 5) complexity = 'M';
    else if (story_points <= 8) complexity = 'L';
    else complexity = 'XL';

    const estimated_hours = story_points * 2; // 2 hours per story point

    return { story_points, complexity, estimated_hours };
  }
}

