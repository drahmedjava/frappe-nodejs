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
  printFormats: [
    {
      name: 'Task Print Format',
      referenceDoctype: 'Task',
      isDefault: true,
      html: `<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .header { border-bottom: 2px solid #333; margin-bottom: 16px; }
    .field-label { font-weight: bold; color: #555; font-size: 12px; text-transform: uppercase; }
    .field-value { margin-bottom: 12px; font-size: 14px; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
    .status-open { background: #dbeafe; color: #1d4ed8; }
    .status-completed { background: #dcfce7; color: #16a34a; }
    .priority-urgent { background: #fee2e2; color: #dc2626; }
  </style>
</head>
<body>
  <div class="header"><h2>{{title}}</h2><p>Task ID: {{name}}</p></div>
  <div class="field-label">Status</div>
  <div class="field-value"><span class="badge status-{{status|lower}}">{{status}}</span></div>
  <div class="field-label">Priority</div>
  <div class="field-value"><span class="badge priority-{{priority|lower}}">{{priority}}</span></div>
  <div class="field-label">Description</div>
  <div class="field-value">{{description}}</div>
  <div class="field-label">Assigned To</div>
  <div class="field-value">{{assigned_to}}</div>
  <div class="field-label">Progress</div>
  <div class="field-value">{{progress}}%</div>
  <div class="field-label">Expected Dates</div>
  <div class="field-value">{{exp_start_date}} → {{exp_end_date}}</div>
</body>
</html>`,
    },
  ],
};
