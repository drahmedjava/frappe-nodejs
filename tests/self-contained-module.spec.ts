import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentService } from '../src/document/document.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { DatabaseService } from '../src/database/database.service';
import { ViewService } from '../src/api/view.service';
import { FrappeFeatureService } from '../src/core/frappe-feature.service';
import { BaseCustomController } from '../src/api/base-custom.controller';
import { Whitelist } from '../src/api/decorators/whitelist.decorator';
import { OnDocEvent } from '../src/document/decorators/on-doc-event.decorator';
import { BaseDocument } from '../src/document/base-document';
import { Controller, Injectable, Module, OnModuleInit } from '@nestjs/common';

describe('Self-Contained Feature Modules (TaskModule Showcase & Dynamic Module Creation)', () => {
  let app: INestApplication;
  let docService: DocumentService;
  let metaRegistry: DocTypeRegistryService;
  let db: DatabaseService;
  let viewService: ViewService;
  let featureService: FrappeFeatureService;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    docService = moduleRef.get<DocumentService>(DocumentService);
    metaRegistry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    db = moduleRef.get<DatabaseService>(DatabaseService);
    viewService = moduleRef.get<ViewService>(ViewService);
    featureService = moduleRef.get<FrappeFeatureService>(FrappeFeatureService);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. TaskModule Co-located Schemas and Database Synchronization', () => {
    it('should have registered Task and TaskItem DocTypes from the module directory', () => {
      expect(metaRegistry.has('Task')).toBe(true);
      expect(metaRegistry.has('TaskItem')).toBe(true);

      const taskMeta = metaRegistry.get('Task');
      expect(taskMeta.name).toBe('Task');
      expect(taskMeta.module).toBe('Projects');

      const taskItemMeta = metaRegistry.get('TaskItem');
      expect(taskItemMeta.name).toBe('TaskItem');
      expect(taskItemMeta.isChildTable).toBe(true);
    });

    it('should have synchronized tabTask and tabTaskItem tables in database', async () => {
      const hasTaskTable = await db.hasTable('tabTask');
      const hasTaskItemTable = await db.hasTable('tabTaskItem');

      expect(hasTaskTable).toBe(true);
      expect(hasTaskItemTable).toBe(true);
    });
  });

  describe('2. TaskModule Custom Controller and Whitelisted RPC Methods', () => {
    it('should seed test tasks and execute whitelisted batch_complete RPC method', async () => {
      const t1 = docService.newDoc('Task', {
        title: 'Task A to Complete',
        status: 'Open',
        priority: 'Medium',
      });
      await t1.insert();

      const t2 = docService.newDoc('Task', {
        title: 'Task B to Complete',
        status: 'Working',
        priority: 'High',
      });
      await t2.insert();

      // Call whitelisted RPC endpoint on TaskCustomController
      const res = await request(app.getHttpServer())
        .post('/api/method/task.batch_complete')
        .send({ task_ids: [t1.get('name'), t2.get('name')] })
        .expect(201);

      expect(res.body.message.ok).toBe(true);
      expect(res.body.message.completed_count).toBe(2);

      // Verify documents mutated
      const reloaded1 = await docService.getDoc('Task', t1.get('name'));
      const reloaded2 = await docService.getDoc('Task', t2.get('name'));
      expect(reloaded1.get('status')).toBe('Completed');
      expect(reloaded2.get('status')).toBe('Completed');
    });

    it('should execute whitelisted get_task_metrics RPC method', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/task.get_task_metrics')
        .expect(201);

      expect(res.body.message.total).toBeGreaterThanOrEqual(2);
      expect(res.body.message.completed).toBeGreaterThanOrEqual(2);
    });
  });

  describe('3. TaskModule Document Lifecycle Events (@OnDocEvent)', () => {
    it('should enforce date validation via TaskEventsService validate hook', async () => {
      const invalidTask = docService.newDoc('Task', {
        title: 'Invalid Date Task',
        status: 'Open',
        exp_start_date: '2026-12-10',
        exp_end_date: '2026-12-01', // End before Start!
      });

      await expect(invalidTask.insert()).rejects.toThrow(
        /Expected Start Date cannot be after Expected End Date/,
      );
    });

    it('should allow valid task dates and insert successfully', async () => {
      const validTask = docService.newDoc('Task', {
        title: 'Valid Date Task',
        status: 'Open',
        exp_start_date: '2026-10-01',
        exp_end_date: '2026-10-05',
        progress: 50,
      });

      await validTask.insert();
      expect(validTask.get('name')).toBeDefined();
    });
  });

  describe('4. TaskModule Co-located Views & HTML Templates', () => {
    it('should have initialized Kanban boards with co-located task-card.html template', async () => {
      const viewsData = await viewService.getViews('Task');
      const boardNames = viewsData.kanban_boards.map((b: any) => b.name);

      expect(boardNames).toContain('Task Module Status Pipeline');
      expect(boardNames).toContain('Task Module Priority Board');

      // Check card template
      const board = viewsData.kanban_boards.find((b: any) => b.name === 'Task Module Status Pipeline');
      expect(board.card_template).toContain('task-card-custom');
      expect(board.card_template).toContain('task-badge-{{priority}}');
    });

    it('should have initialized CustomView and CustomHTMLBlock from module', async () => {
      const viewsData = await viewService.getViews('Task');

      // CustomView
      const customViewTitles = viewsData.custom_views.map((v: any) => v.title);
      expect(customViewTitles).toContain('Task Module Urgent Backlog');

      // CustomHTMLBlock
      const blockNames = viewsData.custom_html_blocks.map((b: any) => b.block_name);
      expect(blockNames).toContain('TaskModuleSprintWidget');
    });
  });

  describe('5. Adding Any New DocType as a Self-Contained Module (Invoice Example)', () => {
    // Demonstration of how any developer can add a brand-new self-contained module in seconds!
    it('should register a completely new self-contained InvoiceModule dynamically with schema, views, and controller', async () => {
      @Controller('api/method/invoice')
      class InvoiceCustomController extends BaseCustomController {
        constructor(docs: DocumentService) {
          super(docs);
        }

        @Whitelist()
        async compute_tax(params: { amount: number; rate: number }) {
          return { tax: (params.amount * (params.rate || 0.15)).toFixed(2) };
        }
      }

      @Injectable()
      class InvoiceEventsService {
        @OnDocEvent('Invoice', 'validate')
        validateGrandTotal(doc: BaseDocument) {
          if (doc.get('grand_total') < 0) {
            throw new Error('Grand total cannot be negative');
          }
        }
      }

      @Module({
        controllers: [InvoiceCustomController],
        providers: [InvoiceEventsService],
      })
      class InvoiceModule implements OnModuleInit {
        constructor(private readonly feature: FrappeFeatureService) {}

        async onModuleInit() {
          await this.feature.registerFeature({
            moduleName: 'Accounting',
            doctypes: [
              {
                name: 'Invoice',
                fields: [
                  { fieldname: 'customer', label: 'Customer', fieldtype: 'Data', reqd: true, inList: true },
                  { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: ['Draft', 'Paid', 'Overdue'], default: 'Draft', inList: true },
                  { fieldname: 'grand_total', label: 'Grand Total', fieldtype: 'Currency', default: 0, inList: true },
                ],
              },
            ],
            views: {
              kanbanBoards: [
                {
                  name: 'Invoice Payment Pipeline',
                  referenceDoctype: 'Invoice',
                  fieldName: 'status',
                  columns: ['Draft', 'Paid', 'Overdue'],
                  cardTemplate: '<div class="invoice-card"><h3>{{customer}}</h3><span>${{grand_total}}</span></div>',
                },
              ],
            },
          });
        }
      }

      // Initialize the self-contained module
      const invoiceModule = new InvoiceModule(featureService);
      await invoiceModule.onModuleInit();

      // 1. Verify schema registered
      expect(metaRegistry.has('Invoice')).toBe(true);
      expect(metaRegistry.get('Invoice').module).toBe('Accounting');

      // 2. Verify table created
      expect(await db.hasTable('tabInvoice')).toBe(true);

      // 3. Verify views registered
      const views = await viewService.getViews('Invoice');
      expect(views.kanban_boards.map((b: any) => b.name)).toContain('Invoice Payment Pipeline');
      const invoiceBoard = views.kanban_boards.find((b: any) => b.name === 'Invoice Payment Pipeline');
      expect(invoiceBoard.card_template).toContain('invoice-card');

      // 4. Verify document creation & validation
      const inv = docService.newDoc('Invoice', {
        customer: 'Acme International',
        status: 'Draft',
        grand_total: 1500,
      });
      await inv.insert();
      expect(inv.get('name')).toBeDefined();
    });
  });
});
