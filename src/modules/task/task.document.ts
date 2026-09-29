import { BaseDocument } from '../../document/base-document';

/**
 * Custom document controller for the Task DocType.
 *
 * Provides lifecycle hooks (validate, before_save) and instance methods
 * that run in the context of a single Task document.
 *
 * Register this with FrappeFeatureService via documentController option.
 */
export class TaskDocument extends BaseDocument {
  /**
   * Validate hook — runs on both insert and save.
   * Enforces date ordering and progress range constraints.
   * Also auto-sets status to 'Completed' when progress reaches 100.
   */
  override async validate(): Promise<void> {
    const progress = this.get('progress');

    // Validate progress range
    if (progress !== undefined && progress !== null) {
      if (progress < 0 || progress > 100) {
        throw new Error('Progress cannot exceed 100%');
      }
    }

    // Auto-complete when progress hits 100
    if (progress === 100) {
      this.set('status', 'Completed');
      this.set('is_completed', 1);
    }

    // Auto-set is_completed when all child TaskItem rows are completed
    const items = this.get('items');
    if (Array.isArray(items) && items.length > 0) {
      const allDone = items.every(
        (item: any) => item.completed === 1 || item.completed === true,
      );
      if (allDone) {
        this.set('is_completed', 1);
      }
    }

    // Validate expected date range
    const start = this.get('exp_start_date');
    const end = this.get('exp_end_date');
    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (startDate > endDate) {
        throw new Error('Expected Start Date cannot be after Expected End Date');
      }
    }
  }

  /**
   * before_save hook — runs before every save (insert + update).
   * Auto-calculates progress from completed TaskItem child rows.
   * Also trims whitespace from title.
   */
  override async before_save(): Promise<void> {
    // Trim title
    const title = this.get('title');
    if (title && typeof title === 'string') {
      this.set('title', title.trim());
    }

    // Auto-calculate progress from child TaskItem rows.
    // Only runs when items are explicitly provided (i.e. on insert or when items
    // are part of the current save payload) to avoid overwriting an explicit
    // progress value set on an update that did not touch the items list.
    const items = this.get('items');
    if (Array.isArray(items) && items.length > 0 && this.isNew) {
      const completedCount = items.filter(
        (item: any) => item.completed === 1 || item.completed === true,
      ).length;
      const calculatedProgress = Math.round((completedCount / items.length) * 100);
      this.set('progress', calculatedProgress);

      // Mark parent as completed if all items are done
      if (completedCount === items.length) {
        this.set('is_completed', 1);
        this.set('status', 'Completed');
      }
    }
  }
}
