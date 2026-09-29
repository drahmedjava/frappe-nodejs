import { BaseDocument } from '../base-document';

export class TaskDocument extends BaseDocument {
  override async validate(): Promise<void> {
    const progress = this.get('progress');
    if (progress !== undefined && progress > 100) {
      throw new Error('Progress cannot exceed 100%');
    }

    if (progress === 100) {
      this.set('status', 'Completed');
      this.set('is_completed', 1);
    }

    // Auto-update is_completed if all child task items are completed
    const items = this.get('items');
    if (Array.isArray(items) && items.length > 0) {
      const allDone = items.every((item) => item.completed === 1 || item.completed === true);
      if (allDone) {
        this.set('is_completed', 1);
      }
    }
  }

  override async before_save(): Promise<void> {
    // Trim title
    const title = this.get('title');
    if (title && typeof title === 'string') {
      this.set('title', title.trim());
    }
  }
}
