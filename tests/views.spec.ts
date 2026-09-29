import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentService } from '../src/document/document.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { ViewService } from '../src/api/view.service';
import { SiteContextService } from '../src/tenant/site-context.service';

describe('Multi-View Support & User-Created Views (Kanban, Calendar, Cards, Custom Views)', () => {
  let app: INestApplication;
  let docService: DocumentService;
  let registry: DocTypeRegistryService;
  let schemaSync: SchemaSyncService;
  let viewService: ViewService;
  let siteContext: SiteContextService;

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
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    viewService = moduleRef.get<ViewService>(ViewService);
    siteContext = moduleRef.get<SiteContextService>(SiteContextService);

    // Sync all DocTypes including KanbanBoard and CustomView
    await schemaSync.syncAll();

    // Seed test Task records
    const t1 = docService.newDoc('Task', {
      title: 'Setup Database Migrations',
      status: 'Open',
      priority: 'High',
      exp_start_date: '2026-10-01',
      exp_end_date: '2026-10-05',
    });
    await t1.insert();

    const t2 = docService.newDoc('Task', {
      title: 'Build Frontend Desk',
      status: 'Working',
      priority: 'Urgent',
      exp_start_date: '2026-10-03',
      exp_end_date: '2026-10-08',
    });
    await t2.insert();

    const t3 = docService.newDoc('Task', {
      title: 'Write Documentation',
      status: 'Completed',
      priority: 'Low',
      exp_start_date: '2026-10-10',
      exp_end_date: '2026-10-12',
    });
    await t3.insert();

    const t4 = docService.newDoc('Task', {
      title: 'Critical Security Audit',
      status: 'Open',
      priority: 'Urgent',
      exp_start_date: '2026-10-02',
      exp_end_date: '2026-10-04',
    });
    await t4.insert();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Introspection of Available Views for a DocType', () => {
    it('should detect Select fields for Kanban and Date fields for Calendar', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_views?doctype=Task')
        .expect(200);

      const data = res.body.message;
      expect(data.doctype).toBe('Task');
      expect(data.available_views).toContain('List');
      expect(data.available_views).toContain('Form');
      expect(data.available_views).toContain('Report');
      expect(data.available_views).toContain('Card');
      expect(data.available_views).toContain('Kanban');
      expect(data.available_views).toContain('Calendar');

      // Groupable Select fields
      const fieldNames = data.groupable_fields.map((f: any) => f.fieldname);
      expect(fieldNames).toContain('status');
      expect(fieldNames).toContain('priority');

      // Date fields
      const dateFieldNames = data.date_fields.map((f: any) => f.fieldname);
      expect(dateFieldNames).toContain('exp_start_date');
      expect(dateFieldNames).toContain('exp_end_date');
    });
  });

  describe('2. User Creating Multiple Kanban Boards for the Same DocType', () => {
    it('should create a Kanban Board grouped by status', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_kanban_board')
        .set('x-frappe-user', 'Administrator')
        .send({
          kanban_board_name: 'Task Status Board',
          reference_doctype: 'Task',
          field_name: 'status',
          columns: ['Open', 'Working', 'Completed', 'Cancelled'],
        })
        .expect(201);

      expect(res.body.message.kanban_board_name).toBe('Task Status Board');
      expect(res.body.message.field_name).toBe('status');
    });

    it('should create a second Kanban Board for the SAME DocType grouped by priority', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_kanban_board')
        .set('x-frappe-user', 'Administrator')
        .send({
          kanban_board_name: 'Task Priority Matrix',
          reference_doctype: 'Task',
          field_name: 'priority',
          columns: ['Low', 'Medium', 'High', 'Urgent'],
        })
        .expect(201);

      expect(res.body.message.kanban_board_name).toBe('Task Priority Matrix');
      expect(res.body.message.field_name).toBe('priority');
    });

    it('should create a third filtered Kanban Board for the SAME DocType (Urgent Only)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_kanban_board')
        .set('x-frappe-user', 'Administrator')
        .send({
          kanban_board_name: 'Urgent Tasks Pipeline',
          reference_doctype: 'Task',
          field_name: 'status',
          columns: ['Open', 'Working', 'Completed'],
          filters: { priority: 'Urgent' },
        })
        .expect(201);

      expect(res.body.message.kanban_board_name).toBe('Urgent Tasks Pipeline');
    });

    it('should list all created boards when querying get_views for Task', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_views?doctype=Task')
        .expect(200);

      const boards = res.body.message.kanban_boards;
      const boardNames = boards.map((b: any) => b.name);
      expect(boardNames).toContain('Task Status Board');
      expect(boardNames).toContain('Task Priority Matrix');
      expect(boardNames).toContain('Urgent Tasks Pipeline');
    });
  });

  describe('3. Kanban Board Data Partitioning & Column Grouping', () => {
    it('should correctly partition Task documents into Status columns', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_kanban_board_data?board_name=Task%20Status%20Board')
        .expect(200);

      const data = res.body.message;
      expect(data.columns).toEqual(['Open', 'Working', 'Completed', 'Cancelled']);
      expect(data.grouped_cards.Open.length).toBe(2); // 'Setup Database Migrations', 'Critical Security Audit'
      expect(data.grouped_cards.Working.length).toBe(1); // 'Build Frontend Desk'
      expect(data.grouped_cards.Completed.length).toBe(1); // 'Write Documentation'
    });

    it('should correctly partition the same Task documents into Priority columns on the second board', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_kanban_board_data?board_name=Task%20Priority%20Matrix')
        .expect(200);

      const data = res.body.message;
      expect(data.columns).toEqual(['Low', 'Medium', 'High', 'Urgent']);
      expect(data.grouped_cards.Urgent.length).toBe(2); // 'Build Frontend Desk', 'Critical Security Audit'
      expect(data.grouped_cards.High.length).toBe(1); // 'Setup Database Migrations'
      expect(data.grouped_cards.Low.length).toBe(1); // 'Write Documentation'
    });

    it('should respect saved filters on the Urgent Tasks Pipeline board', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_kanban_board_data?board_name=Urgent%20Tasks%20Pipeline')
        .expect(200);

      const data = res.body.message;
      expect(data.total_records).toBe(2); // Only the 2 Urgent tasks
      expect(data.grouped_cards.Open.every((c: any) => c.priority === 'Urgent')).toBe(true);
      expect(data.grouped_cards.Working.every((c: any) => c.priority === 'Urgent')).toBe(true);
    });
  });

  describe('4. Moving Cards between Kanban Columns (Drag and Drop Persistence)', () => {
    it('should update document column value via update_card_column API', async () => {
      // Find the 'Setup Database Migrations' task (currently Open)
      const tasks = await docService.getList('Task', { filters: { title: 'Setup Database Migrations' } });
      const task = tasks[0];
      expect(task.status).toBe('Open');

      // Move card to 'Working' column
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.views.update_card_column')
        .set('x-frappe-user', 'Administrator')
        .send({
          doctype: 'Task',
          name: task.name,
          field_name: 'status',
          new_value: 'Working',
        })
        .expect(201);

      expect(res.body.message.ok).toBe(true);
      expect(res.body.message.doc.status).toBe('Working');

      // Verify DB persistence
      const updated = await docService.getDoc('Task', task.name);
      expect(updated.get('status')).toBe('Working');

      // Verify that Kanban data now reflects the move
      const boardRes = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_kanban_board_data?board_name=Task%20Status%20Board')
        .expect(200);

      expect(boardRes.body.message.grouped_cards.Open.length).toBe(1);
      expect(boardRes.body.message.grouped_cards.Working.length).toBe(2);
    });
  });

  describe('5. User Creating and Saving Custom Views (CustomView DocType)', () => {
    it('should save a Custom View preset for a DocType', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.views.create_custom_view')
        .set('x-frappe-user', 'Administrator')
        .send({
          title: 'High Priority Open Tasks',
          reference_doctype: 'Task',
          view_type: 'List',
          filters: { status: 'Open', priority: 'High' },
          columns: ['name', 'title', 'priority', 'status', 'exp_end_date'],
          sort_by: 'exp_end_date',
          sort_order: 'asc',
        })
        .expect(201);

      expect(res.body.message.title).toBe('High Priority Open Tasks');
      expect(res.body.message.reference_doctype).toBe('Task');

      // Verify it appears in get_views
      const viewsRes = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_views?doctype=Task')
        .expect(200);

      const customViews = viewsRes.body.message.custom_views;
      expect(customViews.some((v: any) => v.title === 'High Priority Open Tasks')).toBe(true);
    });
  });

  describe('6. Calendar View Event Mapping', () => {
    it('should query and map Task records into calendar events', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.views.get_calendar_data?doctype=Task')
        .expect(200);

      const data = res.body.message;
      expect(data.events.length).toBe(4);
      expect(data.start_field).toBe('exp_start_date');
      expect(data.end_field).toBe('exp_end_date');

      const firstEvent = data.events[0];
      expect(firstEvent.id).toBeDefined();
      expect(firstEvent.title).toContain('TASK-');
      expect(firstEvent.start).toBeDefined();
      expect(firstEvent.allDay).toBe(true);
    });
  });
});
