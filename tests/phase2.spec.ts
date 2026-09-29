import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { configuration } from '../src/config/configuration';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { MetaModule } from '../src/meta/meta.module';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocumentModule } from '../src/document/document.module';
import { DocumentService } from '../src/document/document.service';
import { NamingService } from '../src/document/naming.service';
import { DocumentEventsService } from '../src/document/document-events.service';
import { TaskDocument } from '../src/document/controllers/task.document';
import { DocType } from '../src/meta/types';
import { NotFoundException } from '@nestjs/common';

describe('Phase 2 ORM & CRUD Tests', () => {
  let moduleRef: TestingModule;
  let db: DatabaseService;
  let registry: DocTypeRegistryService;
  let syncService: SchemaSyncService;
  let docService: DocumentService;
  let namingService: NamingService;
  let eventsService: DocumentEventsService;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
        DatabaseModule,
        MetaModule,
        DocumentModule,
      ],
    }).compile();

    db = moduleRef.get<DatabaseService>(DatabaseService);
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    syncService = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    docService = moduleRef.get<DocumentService>(DocumentService);
    namingService = moduleRef.get<NamingService>(NamingService);
    eventsService = moduleRef.get<DocumentEventsService>(DocumentEventsService);

    // Bootstrap doctypes and DB tables
    await moduleRef.init();
    await syncService.syncAll();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('NamingService', () => {
    it('should generate sequential series names', async () => {
      const taskMeta = registry.get('Task');
      const name1 = await namingService.generateName(taskMeta, {});
      const name2 = await namingService.generateName(taskMeta, {});

      expect(name1).toBe('TASK-00001');
      expect(name2).toBe('TASK-00002');
    });

    it('should support field-based naming', async () => {
      const fieldDocType: DocType = {
        name: 'Role',
        autoname: 'field:role_name',
        fields: [{ fieldname: 'role_name', label: 'Role Name', fieldtype: 'Data', reqd: true }],
      };

      const name = await namingService.generateName(fieldDocType, { role_name: 'Project Manager' });
      expect(name).toBe('Project Manager');
    });

    it('should support 10-character hash naming', async () => {
      const hashDocType: DocType = {
        name: 'LogEntry',
        namingRule: 'hash',
        fields: [{ fieldname: 'message', label: 'Message', fieldtype: 'Text' }],
      };

      const name = await namingService.generateName(hashDocType, {});
      expect(name).toHaveLength(10);
    });
  });

  describe('Document CRUD & Lifecycle Hooks', () => {
    it('should instantiate custom TaskDocument controller', () => {
      const task = docService.newDoc<TaskDocument>('Task', { title: 'Write tests' });
      expect(task).toBeInstanceOf(TaskDocument);
      expect(task.title).toBe('Write tests');
      expect(task.doctype).toBe('Task');
      expect(task.isNew).toBe(true);
    });

    it('should insert document and run lifecycle hooks & events', async () => {
      let eventFired = false;
      eventsService.on('Task:after_save', (payload) => {
        if (payload.name === 'TASK-00003') {
          eventFired = true;
        }
      });

      const task = docService.newDoc<TaskDocument>('Task', {
        title: '  Deploy to Staging  ',
        description: 'Deploy the latest release',
        priority: 'High',
      });

      await task.insert();

      expect(task.name).toBe('TASK-00003');
      expect(task.title).toBe('Deploy to Staging'); // Trimmed by before_save hook
      expect(task.status).toBe('Open'); // Default applied
      expect(task.docstatus).toBe(0);
      expect(task.creation).toBeDefined();
      expect(task.isNew).toBe(false);
      expect(eventFired).toBe(true);

      // Verify DB record
      const dbRow = await db.table('tabTask').where({ name: 'TASK-00003' }).first();
      expect(dbRow.title).toBe('Deploy to Staging');
      expect(dbRow.priority).toBe('High');
    });

    it('should enforce custom controller validation rule', async () => {
      const task = docService.newDoc<TaskDocument>('Task', {
        title: 'Invalid Progress Task',
        progress: 150,
      });

      await expect(task.insert()).rejects.toThrow(/Progress cannot exceed 100%/);
    });

    it('should auto-complete task when progress reaches 100', async () => {
      const task = docService.newDoc<TaskDocument>('Task', {
        title: 'Task to finish',
        progress: 100,
      });

      await task.insert();
      expect(task.status).toBe('Completed');
      expect(task.is_completed).toBe(1);
    });

    it('should update existing document on save()', async () => {
      const task = await docService.getDoc<TaskDocument>('Task', 'TASK-00003');
      task.description = 'Updated description';
      task.progress = 50;

      await task.save();

      const reloaded = await docService.getDoc<TaskDocument>('Task', 'TASK-00003');
      expect(reloaded.description).toBe('Updated description');
      expect(reloaded.progress).toBe(50);
    });
  });

  describe('Child Tables Handling', () => {
    it('should insert and load child table rows', async () => {
      const task = docService.newDoc<TaskDocument>('Task', {
        title: 'Task with Subtasks',
        items: [
          { item_name: 'Subtask 1', completed: 0 },
          { item_name: 'Subtask 2', completed: 0 },
        ],
      });

      await task.insert();
      const taskName = task.name;

      // Verify child table rows in database
      const itemsInDb = await db.table('tabTaskItem').where({ parent: taskName });
      expect(itemsInDb).toHaveLength(2);
      expect(itemsInDb[0].parenttype).toBe('Task');
      expect(itemsInDb[0].parentfield).toBe('items');
      expect(itemsInDb[0].item_name).toBe('Subtask 1');

      // Fetch via getDoc and check rehydrated child table
      const loaded = await docService.getDoc<TaskDocument>('Task', taskName);
      expect(loaded.items).toHaveLength(2);
      expect(loaded.items[0].item_name).toBe('Subtask 1');
      expect(loaded.items[1].item_name).toBe('Subtask 2');
    });

    it('should sync child tables when updated (add/remove items)', async () => {
      const task = docService.newDoc<TaskDocument>('Task', {
        title: 'Task to modify items',
        items: [
          { item_name: 'Original 1', completed: 0 },
          { item_name: 'Original 2', completed: 0 },
        ],
      });
      await task.insert();
      const taskName = task.name;

      // Replace items with new list
      task.items = [
        { item_name: 'Original 1', completed: 1 },
        { item_name: 'Newly Added', completed: 1 },
      ];
      await task.save();

      const reloaded = await docService.getDoc<TaskDocument>('Task', taskName);
      expect(reloaded.items).toHaveLength(2);
      expect(reloaded.items[0].item_name).toBe('Original 1');
      expect(reloaded.items[0].completed).toBe(1);
      expect(reloaded.items[1].item_name).toBe('Newly Added');
      // Validation hook auto-sets is_completed = 1 if all items completed!
      expect(reloaded.is_completed).toBe(1);
    });
  });

  describe('getList Query Capabilities', () => {
    it('should filter documents with object syntax', async () => {
      const list = await docService.getList('Task', {
        filters: { status: 'Completed' },
      });
      expect(list.length).toBeGreaterThan(0);
      for (const row of list) {
        expect(row.status).toBe('Completed');
      }
    });

    it('should filter documents with triple array syntax', async () => {
      const list = await docService.getList('Task', {
        fields: ['name', 'title', 'progress'],
        filters: [['progress', '>=', 50]],
        orderBy: 'creation desc',
        limit: 10,
      });

      expect(list.length).toBeGreaterThan(0);
      for (const row of list) {
        expect(row.progress).toBeGreaterThanOrEqual(50);
        expect(row).toHaveProperty('name');
        expect(row).toHaveProperty('title');
      }
    });
  });

  describe('Submittable Document Lifecycle', () => {
    beforeAll(async () => {
      // Register submittable DocType
      const submittableDocType: DocType = {
        name: 'SalesOrder',
        isSubmittable: true,
        namingRule: 'series',
        autoname: 'SO-.#####',
        fields: [
          { fieldname: 'customer', label: 'Customer', fieldtype: 'Data', reqd: true },
          { fieldname: 'amount', label: 'Amount', fieldtype: 'Currency', default: 0 },
        ],
      };

      registry.register(submittableDocType);
      await syncService.syncDocType(submittableDocType);
    });

    it('should transition draft -> submitted -> cancelled', async () => {
      const order = docService.newDoc('SalesOrder', {
        customer: 'Acme Corp',
        amount: 500,
      });

      await order.insert();
      expect(order.docstatus).toBe(0); // Draft

      await order.submit();
      expect(order.docstatus).toBe(1); // Submitted

      // Verify cannot edit submitted doc
      order.amount = 600;
      await expect(order.save()).rejects.toThrow(/Cannot edit submitted document/);

      // Verify cannot delete submitted doc
      await expect(order.delete()).rejects.toThrow(/Cannot delete submitted document/);

      // Cancel document
      await order.cancel();
      expect(order.docstatus).toBe(2); // Cancelled

      // Verify cannot edit cancelled doc
      await expect(order.save()).rejects.toThrow(/Cannot edit cancelled document/);
    });
  });

  describe('Document Deletion', () => {
    it('should delete document and cascade delete child rows', async () => {
      const task = docService.newDoc<TaskDocument>('Task', {
        title: 'Task to be deleted',
        items: [{ item_name: 'Doomed Subtask', completed: 0 }],
      });

      await task.insert();
      const taskName = task.name;

      await docService.deleteDoc('Task', taskName);

      // Verify parent row is gone
      await expect(docService.getDoc('Task', taskName)).rejects.toThrow(NotFoundException);

      // Verify child rows are gone
      const childRows = await db.table('tabTaskItem').where({ parent: taskName });
      expect(childRows).toHaveLength(0);
    });
  });
});
