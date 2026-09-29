import * as fs from 'fs';
import * as path from 'path';
import { FeatureViewsConfig } from '../../core/frappe-feature.service';

const cardTemplatePath = path.join(__dirname, 'templates', 'task-card.html');
const summaryWidgetPath = path.join(__dirname, 'templates', 'task-summary.html');

export const TASK_VIEWS: FeatureViewsConfig = {
  kanbanBoards: [
    {
      name: 'Task Module Status Pipeline',
      referenceDoctype: 'Task',
      fieldName: 'status',
      columns: ['Open', 'Working', 'Pending Review', 'Completed', 'Cancelled'],
      cardTemplate: fs.existsSync(cardTemplatePath)
        ? fs.readFileSync(cardTemplatePath, 'utf-8')
        : '<div class="custom-card">{{title}} - {{priority}}</div>',
    },
    {
      name: 'Task Module Priority Board',
      referenceDoctype: 'Task',
      fieldName: 'priority',
      columns: ['Urgent', 'High', 'Medium', 'Low'],
    },
  ],
  customViews: [
    {
      title: 'Task Module Urgent Backlog',
      referenceDoctype: 'Task',
      viewType: 'List',
      filters: { priority: 'Urgent' },
    },
  ],
  htmlBlocks: [
    {
      name: 'TaskModuleSprintWidget',
      referenceDoctype: 'Task',
      html: fs.existsSync(summaryWidgetPath)
        ? fs.readFileSync(summaryWidgetPath, 'utf-8')
        : '<div class="sprint-summary">Sprint Progress Active</div>',
      style: '.task-summary-block { background: #eff6ff; padding: 12px; border-radius: 6px; font-weight: 500; }',
    },
  ],
};
