# frappe-nodejs

A full-stack, Frappe-inspired Node.js application framework built on **NestJS** + **SQLite/Knex**. It provides everything you need to build structured, multi-tenant business applications — a metadata-driven ORM, a rich desk UI with multiple views, a public website engine, a permission system, and a self-contained module architecture.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Getting Started](#getting-started)
3. [Self-Contained Feature Modules (Recommended Pattern)](#self-contained-feature-modules)
4. [Metadata & DocType Engine](#metadata--doctype-engine)
5. [Document ORM & Custom Document Controllers](#document-orm--custom-document-controllers)
6. [Event Hooks & Decorators](#event-hooks--decorators)
7. [Custom Controllers & Whitelisted RPC APIs](#custom-controllers--whitelisted-rpc-apis)
8. [Stateless / Backend-Only Features](#stateless--backend-only-features)
9. [Interactive Multi-View Desk UI](#interactive-multi-view-desk-ui)
10. [Public Website & Portal Engine](#public-website--portal-engine)
11. [Multi-Tenancy & Multi-Site](#multi-tenancy--multi-site)
12. [Print Formats, Data Import/Export & Audit Versioning](#print-formats-data-importexport--audit-versioning)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Application Layer                    │
│  TaskModule  │  InvoiceModule  │  CRMModule  │  ...     │
├─────────────────────────────────────────────────────────┤
│                    Core Framework                       │
│  DocType Registry │ Document ORM │ Event System         │
│  View Engine      │ RPC Router   │ Auth & Permissions   │
├──────────────────────────────┬──────────────────────────┤
│      Desk UI (SPA)           │  Public Website Engine   │
│  List│Form│Kanban│Calendar   │  Pages│Templates│Portal  │
├──────────────────────────────┴──────────────────────────┤
│              Database Layer (Knex + SQLite/PG)          │
└─────────────────────────────────────────────────────────┘
```

### Key Design Principles

| Principle | How It Works |
|---|---|
| **Schema-as-JSON** | DocTypes defined in `.json` files; tables auto-created/migrated at startup |
| **Self-contained modules** | One directory = one feature; add one import line to `AppModule` |
| **Lifecycle hooks** | `validate`, `before_save`, `after_save`, `before_submit`, `on_submit`, etc. |
| **Event-driven** | Cross-cutting concerns via `@OnDocEvent` decorators |
| **Whitelisted RPC** | Server methods callable from client via `POST /api/method/<name>` |
| **Multi-tenancy** | Row-level isolation per site/tenant via `isTenantScoped` flag |

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- pnpm

### Installation

```bash
git clone <repo>
cd frappe-nodejs
pnpm install
cp .env.example .env
```

### Running

```bash
# Development with hot-reload
pnpm run start:dev

# Production build
pnpm run build
pnpm run start:prod
```

### Testing

```bash
pnpm test
```

> [!NOTE]
> The framework ships with 17+ test suites covering DocType metadata, document CRUD, multi-tenancy, views, website, custom controllers, and more.

---

## Self-Contained Feature Modules

The recommended pattern for adding any new feature — whether it's a new DocType, business logic, or UI views — is to create a **self-contained NestJS module** in `src/modules/<feature>/`.

Everything related to a feature lives together: schemas, controller, events, views, and templates.

### Directory Structure

```
src/modules/task/
├── doctypes/
│   ├── task.json           # Main DocType schema
│   └── task-item.json      # Child table DocType schema
├── templates/
│   ├── task-card.html      # Custom Kanban card template
│   └── task-summary.html   # Custom HTML dashboard block
├── task.document.ts        # Custom Document controller (lifecycle hooks)
├── task.controller.ts      # Custom RPC API methods
├── task.events.ts          # Cross-cutting event handlers
├── task.views.ts           # Kanban boards, custom views, HTML blocks
└── task.module.ts          # NestJS module — registers everything
```

### Registering a Module

Add a **single import** to [`src/app.module.ts`](file:///work/code/my-work/frappe-nodejs/src/app.module.ts):

```typescript
import { TaskModule } from './modules/task/task.module';

@Module({
  imports: [
    // ... other modules
    CoreModule,     // required — provides FrappeFeatureService
    TaskModule,     // ← add your module here
  ],
})
export class AppModule {}
```

That's it. On startup, `TaskModule.onModuleInit()` calls `FrappeFeatureService.registerFeature()` which automatically:

1. Loads DocType JSON files from `doctypes/`
2. Runs DDL migrations (CREATE TABLE / ALTER TABLE)
3. Registers the custom Document controller
4. Seeds Kanban boards, custom views, and HTML blocks

### Module Definition

```typescript
// src/modules/task/task.module.ts
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
})
export class TaskModule implements OnModuleInit {
  constructor(private readonly featureService: FrappeFeatureService) {}

  async onModuleInit() {
    await this.featureService.registerFeature({
      moduleName: 'Projects',
      doctypesPath: path.join(__dirname, 'doctypes'),   // load all *.json here
      documentController: {
        doctype: 'Task',
        controllerClass: TaskDocument,                   // custom lifecycle hooks
      },
      views: TASK_VIEWS,                                 // seed views on startup
    });
  }
}
```

---

## Metadata & DocType Engine

DocTypes are the foundation. Every database table, form, and API endpoint is described by a DocType JSON file.

### DocType JSON Schema

```jsonc
// src/modules/task/doctypes/task.json
{
  "name": "Task",
  "module": "Projects",
  "namingRule": "series",       // auto-naming strategy: "series" | "field" | "expression"
  "autoname": "TASK-.#####",   // generates TASK-00001, TASK-00002, ...
  "titleField": "title",        // used in List and search
  "searchFields": ["title", "status", "assigned_to"],
  "isSubmittable": false,       // enable submit/cancel workflow
  "isTenantScoped": false,      // multi-tenant row isolation
  "fields": [
    {
      "fieldname": "title",
      "label": "Title",
      "fieldtype": "Data",
      "reqd": true,
      "inList": true            // show this column in List view
    },
    {
      "fieldname": "status",
      "label": "Status",
      "fieldtype": "Select",
      "options": ["Open", "Working", "Pending Review", "Completed", "Cancelled"],
      "default": "Open",
      "inList": true,
      "inFilter": true          // allow filtering by this field
    },
    {
      "fieldname": "due_date",
      "label": "Due Date",
      "fieldtype": "Date"
    },
    {
      "fieldname": "progress",
      "label": "Progress",
      "fieldtype": "Int",
      "default": 0
    },
    {
      "fieldname": "items",
      "label": "Task Items",
      "fieldtype": "Table",
      "options": "TaskItem"     // reference to child DocType
    },
    {
      "fieldname": "overview_html",
      "label": "Task Overview",
      "fieldtype": "HTML",      // rendered as static HTML in Form view
      "options": "<div><h4>📋 Task Overview</h4><p>Track your task here.</p></div>"
    }
  ],
  "permissions": [
    { "role": "System Manager", "read": true, "write": true, "create": true, "delete": true },
    { "role": "All", "read": true }
  ]
}
```

### Supported Field Types

| Type | Description | DB Column |
|---|---|---|
| `Data` | Single-line string | `varchar(255)` |
| `Text` | Multi-line string | `text` |
| `Int` | Integer | `integer` |
| `Float` | Decimal number | `float` |
| `Check` | Boolean (0/1) | `integer` |
| `Date` | ISO date string | `varchar(255)` |
| `Datetime` | ISO datetime | `varchar(255)` |
| `Select` | Enum from options list | `varchar(255)` |
| `Link` | Foreign key to another DocType | `varchar(255)` |
| `Password` | Encrypted string | `varchar(255)` |
| `Code` | Code editor field | `text` |
| `HTML` | Static HTML rendered in form | `text` |
| `Table` | Child table (linked DocType) | *(no column — separate table)* |

### Naming Rules

| `namingRule` | How Names Are Generated |
|---|---|
| `"series"` | Auto-increment based on `autoname` pattern, e.g. `TASK-.#####` → `TASK-00001` |
| `"field"` | Value copied from a specific field (set `autoname` to field name) |
| `"expression"` | Custom expression pattern |

### Dynamic Schema Sync

When a DocType is registered via `FrappeFeatureService`, the schema sync service automatically runs DDL:

- If the table doesn't exist → `CREATE TABLE`
- If new fields were added → `ALTER TABLE ADD COLUMN`
- No data loss — existing rows are preserved

You can also add or modify DocTypes at runtime from the Desk UI and they will persist immediately.

---

## Document ORM & Custom Document Controllers

### Basic CRUD via HTTP API

Every DocType automatically gets REST endpoints:

```bash
# Create a task
POST /api/resource/Task
{ "title": "Fix the bug", "priority": "High", "status": "Open" }

# List tasks with filters
GET /api/resource/Task?filters={"status":"Open"}&limit=20

# Get a single task
GET /api/resource/Task/TASK-00001

# Update a task
PUT /api/resource/Task/TASK-00001
{ "status": "Completed" }

# Delete a task
DELETE /api/resource/Task/TASK-00001
```

### Custom Document Controller

Create a class extending `BaseDocument` in your module directory to add lifecycle hook logic:

```typescript
// src/modules/task/task.document.ts
import { BaseDocument } from '../../document/base-document';

export class TaskDocument extends BaseDocument {
  /**
   * validate() — runs on every insert and save.
   * Use for data integrity rules.
   */
  override async validate(): Promise<void> {
    const progress = this.get('progress');

    if (progress !== undefined && (progress < 0 || progress > 100)) {
      throw new Error('Progress must be between 0 and 100');
    }

    // Auto-complete when progress hits 100
    if (progress === 100) {
      this.set('status', 'Completed');
      this.set('is_completed', 1);
    }

    // Validate expected date range
    const start = this.get('exp_start_date');
    const end = this.get('exp_end_date');
    if (start && end && new Date(start) > new Date(end)) {
      throw new Error('Start date cannot be after end date');
    }
  }

  /**
   * before_save() — runs before every save (insert + update).
   * Use for derived field calculations.
   */
  override async before_save(): Promise<void> {
    // Trim whitespace from title
    const title = this.get('title');
    if (title && typeof title === 'string') {
      this.set('title', title.trim());
    }

    // Auto-calculate progress from child TaskItem rows
    const items = this.get('items');
    if (Array.isArray(items) && items.length > 0) {
      const completedCount = items.filter(
        (item: any) => item.completed === 1 || item.completed === true,
      ).length;
      const calculatedProgress = Math.round((completedCount / items.length) * 100);
      this.set('progress', calculatedProgress);

      if (completedCount === items.length) {
        this.set('is_completed', 1);
        this.set('status', 'Completed');
      }
    }
  }
}
```

### Available Lifecycle Hooks

| Hook | When It Runs |
|---|---|
| `before_insert()` | Before a new document is first saved |
| `validate()` | On every insert and save (before DB write) |
| `before_save()` | Just before the DB write on insert or update |
| `after_save()` | After successful DB write |
| `before_submit()` | Before `docstatus` changes to 1 (submitted) |
| `on_submit()` | After document is submitted |
| `before_cancel()` | Before `docstatus` changes to 2 (cancelled) |
| `on_cancel()` | After document is cancelled |
| `before_delete()` | Before document is deleted |
| `after_delete()` | After document is deleted |

### Document Methods Available in Hooks

Inside lifecycle hooks, you have access to:

```typescript
this.get('fieldname')           // read a field value
this.set('fieldname', value)    // set a field value
await this.getDoc('DocType', 'name')  // fetch another document
await this.getList('DocType', { filters: {...}, limit: 10 })
await this.deleteDoc('DocType', 'name')
this.newDoc('DocType', { ...data })   // create in-memory doc
this.asJson()                   // get plain object representation
await this.getVersions()        // get audit history
```

### Submittable Documents

Set `"isSubmittable": true` in the DocType JSON to enable the submit/cancel workflow:

```bash
POST /api/resource/Task/TASK-00001/submit
POST /api/resource/Task/TASK-00001/cancel
POST /api/resource/Task/TASK-00001/amend
```

---

## Event Hooks & Decorators

Event hooks let you add cross-cutting behavior — like validation, notifications, or analytics — without modifying the core document logic. They run on any document event using the `@OnDocEvent` decorator.

### Creating an Event Handler

```typescript
// src/modules/task/task.events.ts
import { Injectable, BadRequestException } from '@nestjs/common';
import { OnDocEvent } from '../../document/decorators/on-doc-event.decorator';
import { DocumentEventPayload } from '../../document/types';

@Injectable()
export class TaskEventsService {
  /**
   * Fires on every Task validate event.
   * payload.doc is the full BaseDocument instance.
   */
  @OnDocEvent('Task', 'validate')
  validateDates(payload: DocumentEventPayload) {
    const doc = payload.doc;
    const start = doc.get('exp_start_date');
    const end = doc.get('exp_end_date');

    if (start && end) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (startDate > endDate) {
        throw new BadRequestException(
          'Expected Start Date cannot be after Expected End Date',
        );
      }
    }

    const progress = doc.get('progress');
    if (progress !== undefined && progress !== null) {
      if (progress < 0 || progress > 100) {
        throw new BadRequestException('Progress must be between 0 and 100');
      }
    }
  }
}
```

### Supported Event Names

`before_insert` · `validate` · `before_save` · `after_save` · `before_submit` · `on_submit` · `before_cancel` · `on_cancel` · `before_delete` · `after_delete`

### Registering Event Handlers

Event handler services must be listed as `providers` in your module:

```typescript
@Module({
  providers: [TaskEventsService],   // ← registered here
})
export class TaskModule { ... }
```

> [!IMPORTANT]
> The `@OnDocEvent` handler receives a `DocumentEventPayload` object, **not** the doc directly. Always use `payload.doc.get('field')` — not `doc.field` — to safely read field values.

---

## Custom Controllers & Whitelisted RPC APIs

Use `@Whitelist` to expose server-side methods as callable HTTP endpoints.

### Creating Custom RPC Methods

```typescript
// src/modules/task/task.controller.ts
import { Controller } from '@nestjs/common';
import { BaseCustomController } from '../../api/base-custom.controller';
import { Whitelist } from '../../api/decorators/whitelist.decorator';
import { DocumentService } from '../../document/document.service';

@Controller('api/method/task')
export class TaskCustomController extends BaseCustomController {
  constructor(docService: DocumentService) {
    super(docService);
  }

  /**
   * Batch complete multiple tasks by ID.
   * Callable via: POST /api/method/task.batch_complete
   */
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

  /**
   * Get task summary metrics.
   * Callable via: POST /api/method/task.get_task_metrics
   */
  @Whitelist({ name: 'task.get_task_metrics', isPublic: true })
  async get_task_metrics() {
    const tasks = await this.getList('Task', { limit: 100 });
    const completed = tasks.filter(
      (t: any) => t.status === 'Completed' || t.is_completed === 1,
    ).length;
    return { total: tasks.length, completed, pending: tasks.length - completed };
  }
}
```

### Calling RPC Methods

```bash
# From client or curl
POST /api/method/task.batch_complete
Content-Type: application/json
{ "task_ids": ["TASK-00001", "TASK-00002"] }

# Response
{ "message": { "ok": true, "completed_count": 2 } }
```

### `BaseCustomController` Helpers

All custom controllers extend `BaseCustomController` which provides:

```typescript
await this.getDoc('DocType', 'name')          // fetch a document
await this.getList('DocType', { ...options }) // query list
this.newDoc('DocType', { ...data })           // create in-memory doc
await this.deleteDoc('DocType', 'name')       // delete a document
```

### `@Whitelist` Options

| Option | Type | Description |
|---|---|---|
| `name` | `string` | The RPC route: `POST /api/method/<name>` |
| `isPublic` | `boolean` | If `false`, requires authentication |

---

## Stateless / Backend-Only Features

Not every feature needs database access. `@Whitelist` methods can be purely computational — accepting input, applying business logic, and returning results without any DB calls.

This covers scenarios like:
- **Estimation engines** — story point calculators, pricing engines
- **Contact forms** — validate input, send email, return confirmation
- **Payment gateway integration** — validate, tokenize, call external API
- **Data transformation** — convert formats, parse documents

### Example: Effort Estimator (No DB)

```typescript
/**
 * Stateless effort estimator — no DB access.
 * Callable via: POST /api/method/task.estimate_effort
 */
@Whitelist({ name: 'task.estimate_effort', isPublic: true })
estimate_effort(params: { description?: string; checklist_count?: number }): {
  story_points: number;
  complexity: string;
  estimated_hours: number;
} {
  const descLength = (params.description || '').length;
  const checklistCount = params.checklist_count ?? 0;

  // Heuristic: 1 point per 100 chars + 0.5 per checklist item
  const rawPoints = Math.ceil(descLength / 100) + Math.ceil(checklistCount * 0.5);
  const story_points = Math.min(Math.max(rawPoints, 1), 13);

  let complexity: string;
  if (story_points <= 2) complexity = 'XS';
  else if (story_points <= 5) complexity = 'M';
  else if (story_points <= 8) complexity = 'L';
  else complexity = 'XL';

  return { story_points, complexity, estimated_hours: story_points * 2 };
}
```

```bash
POST /api/method/task.estimate_effort
{ "description": "Implement OAuth login with Google and GitHub", "checklist_count": 5 }

# Response
{ "message": { "story_points": 5, "complexity": "M", "estimated_hours": 10 } }
```

### Example: Contact Form (Validate + Email, No DB)

For a contact form or any input-validate-act pattern, create a dedicated module:

```typescript
// src/modules/contact/contact.controller.ts
@Controller('api/method/contact')
export class ContactController extends BaseCustomController {

  @Whitelist({ name: 'contact.send', isPublic: true })
  async send(params: { name: string; email: string; message: string }) {
    if (!params.email?.includes('@')) {
      throw new BadRequestException('Invalid email address');
    }
    if (!params.message || params.message.length < 10) {
      throw new BadRequestException('Message too short');
    }
    // Call your email service / SendGrid / SMTP here
    // await this.emailService.send({ to: 'info@company.com', ...params });
    return { ok: true, message: 'Your message has been sent!' };
  }
}
```

### Example: Payment Gateway Integration

```typescript
@Whitelist({ name: 'payments.initiate', isPublic: false })  // requires auth
async initiatePayment(params: { amount: number; currency: string; order_id: string }) {
  // No DB needed — just call Stripe/Razorpay/PayPal
  const session = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price_data: { currency: params.currency, unit_amount: params.amount * 100 }, quantity: 1 }],
    mode: 'payment',
    success_url: 'https://yourapp.com/payment-success',
  });
  return { session_id: session.id, url: session.url };
}
```

> [!TIP]
> Stateless methods are ideal for integration tests — no database setup required, just call the method with params and assert the response.

---

## Interactive Multi-View Desk UI

The Desk UI is a single-page application served at `/app` that provides multiple views for every DocType.

### Available Views

| View | Description | How to Access |
|---|---|---|
| **List View** | Paginated, sortable, filterable table of documents | `/app/task` |
| **Form View** | Full document editor with all fields and child tables | `/app/task/TASK-00001` |
| **Kanban View** | Drag-and-drop board organized by a Select field | Created via `createKanbanBoard()` |
| **Calendar View** | Documents plotted on a monthly calendar by date field | `/app/task?view=calendar` |
| **Card View** | Visual grid of cards, optionally with custom templates | Created via `createCustomView()` |
| **Report Builder** | Dynamic pivot/tabular report with filters and columns | Desk → Report Builder |
| **HTML Blocks** | Custom embedded HTML/JS widgets in the desk | Defined in module views config |

### Seeding Views from a Module

Define all views in `task.views.ts` — they are auto-seeded on module startup:

```typescript
// src/modules/task/task.views.ts
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
      // Custom card template — loaded from co-located HTML file
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
      filters: { priority: 'Urgent' },  // pre-filtered view
    },
  ],
  htmlBlocks: [
    {
      name: 'TaskModuleSprintWidget',
      referenceDoctype: 'Task',
      html: fs.existsSync(summaryWidgetPath)
        ? fs.readFileSync(summaryWidgetPath, 'utf-8')
        : '<div class="sprint-summary">Sprint Progress Active</div>',
      style: '.task-summary-block { background: #eff6ff; padding: 12px; }',
    },
  ],
};
```

### Custom Card Templates

Kanban and Card views support HTML templates with `{{field}}` interpolation:

```html
<!-- src/modules/task/templates/task-card.html -->
<div class="task-card-custom">
  <div class="task-badge task-badge-{{priority}}">{{priority}}</div>
  <h4 class="task-card-title">{{title}}</h4>
  <div class="task-card-footer">
    <span class="task-assignee">👤 {{assigned_to}}</span>
    <span class="task-status-pill">{{status}}</span>
  </div>
</div>
```

### Creating Views at Runtime

Users can also create views from the Desk UI or via API:

```bash
# Create a new Kanban board
POST /api/method/frappe.views.create_kanban_board
{
  "kanban_board_name": "My Sprint Board",
  "reference_doctype": "Task",
  "field_name": "status",
  "columns": ["Open", "Working", "Completed"]
}

# Get all views for a DocType
POST /api/method/frappe.views.get_views
{ "doctype": "Task" }

# Get calendar data
POST /api/method/frappe.views.get_calendar_data
{ "doctype": "Task", "start": "2024-01-01", "end": "2024-01-31", "date_field": "due_date" }
```

---

## Public Website & Portal Engine

The framework includes a full public website engine served at `/` (the root).

### Creating Web Pages

```bash
# Create a public web page
POST /api/resource/WebPage
{
  "route": "about-us",
  "title": "About Us",
  "content": "<h1>Welcome!</h1><p>We build amazing things.</p>",
  "published": true
}

# Access it at: http://yourdomain.com/about-us
```

### Template Variables

Page content supports `{{ variable }}` interpolation:

```html
<!-- In WebPage.content field -->
<h1>Hello, {{ user_name }}!</h1>
<p>Your company: {{ company }}</p>
```

### Website Settings

Configure global site settings per hostname for multi-site branding:

```bash
POST /api/resource/WebsiteSettings
{
  "site_name": "My App",
  "home_page": "home",
  "banner_html": "<div class='banner'>🚀 New Feature Released!</div>",
  "top_bar_items": [
    { "label": "Home", "url": "/" },
    { "label": "Docs", "url": "/docs" },
    { "label": "Contact", "url": "/contact" }
  ],
  "custom_css": "body { font-family: 'Inter', sans-serif; }",
  "custom_js": "console.log('site loaded');"
}
```

### Website RPC Methods

```bash
POST /api/method/frappe.website.get_settings   # → WebsiteSettings for current host
POST /api/method/frappe.website.get_page       # { "route": "about-us" } → WebPage doc
POST /api/method/frappe.website.render_template # { "template": "Hello {{name}}", "context": {"name": "World"} }
```

---

## Multi-Tenancy & Multi-Site

The framework supports two levels of multi-tenancy out of the box.

### Per-Tenant Row Isolation

Enable tenant scoping on a DocType:

```json
{
  "name": "Invoice",
  "isTenantScoped": true,
  ...
}
```

With `isTenantScoped: true`:
- All queries are automatically filtered by `tenant_id`
- Documents are stamped with `tenant_id` on insert
- Cross-tenant access raises a permission error

```typescript
// Set the active tenant context (typically from JWT or session)
await siteContextService.run('tenant-abc', async () => {
  // All Document operations are scoped to tenant-abc
  const invoices = await documentService.getList('Invoice');
  // Returns ONLY Invoice records with tenant_id = 'tenant-abc'
});
```

### Multi-Site (Per-Host Branding)

The website engine reads the `Host` HTTP header to serve different `WebsiteSettings` per domain. Each site gets its own navbar, CSS, banner HTML, and home page without separate deployments.

---

## Print Formats, Data Import/Export & Audit Versioning

### Print Formats

Print formats let you define custom HTML templates for printing or PDF export of any DocType.

```bash
# Create a print format via API
POST /api/resource/PrintFormat
{
  "name_format": "Task Detail Sheet",
  "doc_type": "Task",
  "standard": false,
  "html": "<!DOCTYPE html><html><body><h1>{{title}}</h1><p>Status: {{status}}</p></body></html>",
  "css": "body { font-family: sans-serif; } h1 { color: #333; }"
}
```

Print formats support `{{fieldname}}` template interpolation and can be seeded from a module's views config:

```typescript
// In task.views.ts — printFormats array
printFormats: [
  {
    name: 'Task Print Format',
    referenceDoctype: 'Task',
    isDefault: true,
    html: `<html>
      <body>
        <h2>{{title}}</h2>
        <p>Status: <b>{{status}}</b> | Priority: <b>{{priority}}</b></p>
        <p>Progress: {{progress}}%</p>
        <p>{{description}}</p>
      </body>
    </html>`,
  },
],
```

### Data Import

Import documents in bulk from JSON or CSV:

```bash
POST /api/resource/DataImport
{
  "reference_doctype": "Task",
  "import_type": "Insert New Records",
  "payload": [
    { "title": "Task A", "priority": "High", "status": "Open" },
    { "title": "Task B", "priority": "Medium", "status": "Open" }
  ]
}
```

### Audit Versioning

Every time a document is saved, the framework automatically records a diff in the `Version` DocType table:

```bash
# Fetch audit history for a document
GET /api/resource/Version?filters={"ref_doctype":"Task","docname":"TASK-00001"}

# Or via the BaseDocument method inside a hook:
const versions = await this.getVersions();
# Returns: [{ changed: [["status", "Open", "Completed"], ...], creation: "..." }, ...]
```

The `changed` array records `[fieldname, old_value, new_value]` tuples for each modified field.

---

## Complete Example: Adding a New Module

Here's the minimum needed to add a new `Invoice` feature module:

```
src/modules/invoice/
├── doctypes/
│   └── invoice.json
├── invoice.document.ts    (optional)
├── invoice.controller.ts  (optional)
├── invoice.events.ts      (optional)
├── invoice.views.ts       (optional)
└── invoice.module.ts
```

**1. Define the DocType:**

```json
// src/modules/invoice/doctypes/invoice.json
{
  "name": "Invoice",
  "module": "Billing",
  "namingRule": "series",
  "autoname": "INV-.#####",
  "isSubmittable": true,
  "fields": [
    { "fieldname": "customer", "label": "Customer", "fieldtype": "Data", "reqd": true, "inList": true },
    { "fieldname": "amount", "label": "Amount", "fieldtype": "Float", "reqd": true, "inList": true },
    { "fieldname": "due_date", "label": "Due Date", "fieldtype": "Date" },
    { "fieldname": "status", "label": "Status", "fieldtype": "Select", "options": ["Draft", "Sent", "Paid"], "default": "Draft", "inList": true, "inFilter": true }
  ],
  "permissions": [
    { "role": "System Manager", "read": true, "write": true, "create": true, "delete": true }
  ]
}
```

**2. Create the module:**

```typescript
// src/modules/invoice/invoice.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import * as path from 'path';
import { FrappeFeatureService } from '../../core/frappe-feature.service';

@Module({})
export class InvoiceModule implements OnModuleInit {
  constructor(private readonly featureService: FrappeFeatureService) {}

  async onModuleInit() {
    await this.featureService.registerFeature({
      moduleName: 'Billing',
      doctypesPath: path.join(__dirname, 'doctypes'),
    });
  }
}
```

**3. Register in AppModule:**

```typescript
import { InvoiceModule } from './modules/invoice/invoice.module';

@Module({
  imports: [..., CoreModule, InvoiceModule],
})
export class AppModule {}
```

Done. The `Invoice` DocType is now live:
- Table auto-created in DB
- REST API available at `/api/resource/Invoice`
- Form and List views available at `/app/invoice`
- Submit/Cancel workflow enabled

---

## Project Structure Reference

```
src/
├── modules/            ← Your feature modules live here
│   └── task/           ← Example: Task module
├── core/               ← FrappeFeatureService coordinator
├── api/                ← REST API, RPC method router, view service
├── document/           ← Document ORM, BaseDocument, event system
├── meta/               ← DocType registry, schema sync, built-in doctypes
├── desk/               ← Desk UI HTML (server-rendered SPA)
├── website/            ← Public website engine
├── auth/               ← Authentication
├── tenant/             ← Multi-tenancy context
├── database/           ← Knex database abstraction
├── lowcode/            ← Server scripts, workflows, notifications
└── peripheral/         ← Data import/export, print formats
```
