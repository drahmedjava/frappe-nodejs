import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { DocumentService } from '../src/document/document.service';
import { DocType } from '../src/meta/types';

describe('Phase 8 Document Lifecycle Extras (Amendments & Version Tracking)', () => {
  let app: INestApplication;
  let syncService: SchemaSyncService;
  let registry: DocTypeRegistryService;
  let docService: DocumentService;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    syncService = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    docService = moduleRef.get<DocumentService>(DocumentService);

    // Register submittable PurchaseOrder DocType with an item child table
    const poItemDocType: DocType = {
      name: 'PurchaseOrderItem',
      isChildTable: true,
      fields: [
        { fieldname: 'item_code', label: 'Item Code', fieldtype: 'Data', reqd: true },
        { fieldname: 'qty', label: 'Qty', fieldtype: 'Float', default: 1 },
      ],
    };

    const poDocType: DocType = {
      name: 'PurchaseOrder',
      isSubmittable: true,
      namingRule: 'series',
      autoname: 'PO-.#####',
      fields: [
        { fieldname: 'supplier', label: 'Supplier', fieldtype: 'Data', reqd: true },
        { fieldname: 'total_amount', label: 'Total Amount', fieldtype: 'Currency', default: 0 },
        { fieldname: 'items', label: 'Items', fieldtype: 'Table', options: 'PurchaseOrderItem' },
      ],
      permissions: [
        { role: 'System Manager', read: true, write: true, create: true, submit: true, cancel: true, amend: true },
        { role: 'All', read: true },
      ],
    };

    registry.register(poItemDocType);
    registry.register(poDocType);

    // Sync all DocTypes into SQLite
    await syncService.syncAll();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Submittable Document Lifecycle & Amendments', () => {
    it('should disallow amending non-submittable documents', async () => {
      const task = docService.newDoc('Task', { title: 'Ordinary Task' });
      await task.insert();
      await expect(task.amend()).rejects.toThrow(/is not submittable/);
    });

    it('should disallow amending draft or submitted documents', async () => {
      const po = docService.newDoc('PurchaseOrder', {
        supplier: 'Acme Hardware',
        total_amount: 1000,
      });
      await po.insert();
      expect(po.docstatus).toBe(0);
      await expect(po.amend()).rejects.toThrow(/Only cancelled documents can be amended/);

      await po.submit();
      expect(po.docstatus).toBe(1);
      await expect(po.amend()).rejects.toThrow(/Only cancelled documents can be amended/);
    });

    it('should amend a cancelled document and increment amendment series', async () => {
      // 1. Create and submit
      const po = docService.newDoc('PurchaseOrder', {
        supplier: 'Acme Hardware',
        total_amount: 1500,
        items: [
          { item_code: 'BOLT-01', qty: 50 },
          { item_code: 'NUT-01', qty: 50 },
        ],
      });
      await po.insert();
      const originalName = po.name;
      expect(originalName).toMatch(/^PO-\d{5}$/);

      await po.submit();
      expect(po.docstatus).toBe(1);

      // 2. Cancel
      await po.cancel();
      expect(po.docstatus).toBe(2);

      // 3. Amend -> creates PO-0000X-1
      const amendedPo = await po.amend('Administrator');
      expect(amendedPo.name).toBe(`${originalName}-1`);
      expect(amendedPo.amended_from).toBe(originalName);
      expect(amendedPo.docstatus).toBe(0); // Back to Draft
      expect(amendedPo.supplier).toBe('Acme Hardware');
      expect(amendedPo.total_amount).toBe(1500);
      expect(amendedPo.items).toHaveLength(2);
      expect(amendedPo.items[0].item_code).toBe('BOLT-01');
      expect(amendedPo.items[0].docstatus).toBe(0);

      // Verify amended document was persisted to DB
      const loaded = await docService.getDoc('PurchaseOrder', `${originalName}-1`);
      expect(loaded.amended_from).toBe(originalName);
      expect(loaded.docstatus).toBe(0);

      // 4. Submit amended PO and cancel it
      await amendedPo.submit();
      expect(amendedPo.docstatus).toBe(1);

      await amendedPo.cancel();
      expect(amendedPo.docstatus).toBe(2);

      // 5. Amend again -> creates PO-0000X-2
      const secondAmendment = await amendedPo.amend('Administrator');
      expect(secondAmendment.name).toBe(`${originalName}-2`);
      expect(secondAmendment.amended_from).toBe(`${originalName}-1`);
      expect(secondAmendment.docstatus).toBe(0);
    });
  });

  describe('Version Diff Tracking', () => {
    it('should record version diffs on document save', async () => {
      // Create a task
      const task = docService.newDoc('Task', {
        title: 'Initial Version Title',
        priority: 'Low',
        progress: 10,
        status: 'Open',
      });
      await task.insert();

      // No versions right after creation
      let versions = await task.getVersions();
      expect(versions).toHaveLength(0);

      // Edit task fields
      task.title = 'Updated Version Title';
      task.priority = 'Urgent';
      await task.save('Auditor');

      // Check version record
      versions = await task.getVersions();
      expect(versions).toHaveLength(1);
      const v1 = versions[0];
      expect(v1.ref_doctype).toBe('Task');
      expect(v1.docname).toBe(task.name);
      expect(v1.modified_by).toBe('Auditor');

      const diff1 = v1.data;
      expect(diff1.changed).toEqual(
        expect.arrayContaining([
          ['title', 'Initial Version Title', 'Updated Version Title'],
          ['priority', 'Low', 'Urgent'],
        ]),
      );

      // Second edit
      task.status = 'Working';
      task.progress = 50;
      await task.save('Developer');

      versions = await task.getVersions();
      expect(versions).toHaveLength(2);
      // Newest first
      expect(versions[0].modified_by).toBe('Developer');
      expect(versions[0].data.changed).toEqual(
        expect.arrayContaining([
          ['status', 'Open', 'Working'],
          ['progress', 10, 50],
        ]),
      );
    });
  });

  describe('REST API for Amendments & Versions', () => {
    it('POST /api/resource/:doctype/:name/amend - should amend cancelled doc via HTTP', async () => {
      // Create, submit, cancel PO via docService
      const po = docService.newDoc('PurchaseOrder', {
        supplier: 'HTTP Supplier Ltd',
        total_amount: 3200,
      });
      await po.insert();
      await po.submit();
      await po.cancel();

      // Call amend endpoint
      const res = await request(app.getHttpServer())
        .post(`/api/resource/PurchaseOrder/${po.name}/amend`)
        .set('x-frappe-user', 'Administrator')
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe(`${po.name}-1`);
      expect(res.body.data.amended_from).toBe(po.name);
      expect(res.body.data.docstatus).toBe(0);
    });

    it('GET /api/resource/:doctype/:name/versions - should retrieve version list via HTTP', async () => {
      const task = docService.newDoc('Task', {
        title: 'Task For HTTP Versions',
        priority: 'Medium',
      });
      await task.insert();
      task.priority = 'High';
      await task.save();

      const res = await request(app.getHttpServer())
        .get(`/api/resource/Task/${task.name}/versions`)
        .set('x-frappe-user', 'Administrator')
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].ref_doctype).toBe('Task');
      expect(res.body.data[0].docname).toBe(task.name);
      expect(res.body.data[0].data.changed).toBeDefined();
    });
  });
});
