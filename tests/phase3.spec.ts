import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { MethodRegistryService } from '../src/api/method-registry.service';
import { DocumentService } from '../src/document/document.service';
import { DocType } from '../src/meta/types';

describe('Phase 3 API + Auth Tests', () => {
  let app: INestApplication;
  let syncService: SchemaSyncService;
  let registry: DocTypeRegistryService;
  let methodRegistry: MethodRegistryService;
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
    methodRegistry = moduleRef.get<MethodRegistryService>(MethodRegistryService);
    docService = moduleRef.get<DocumentService>(DocumentService);

    // Sync all DocTypes into SQLite
    await syncService.syncAll();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('REST Resource API (/api/resource/:doctype)', () => {
    let createdTaskName: string;

    it('POST /api/resource/Task - should create new Task with child items', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/resource/Task')
        .send({
          title: 'API Integration Task',
          description: 'Created through REST API',
          priority: 'High',
          items: [
            { item_name: 'Subtask 1 via API', completed: false },
            { item_name: 'Subtask 2 via API', completed: true },
          ],
        })
        .expect(201);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toMatch(/^TASK-\d{5}$/);
      expect(res.body.data.title).toBe('API Integration Task');
      expect(res.body.data.status).toBe('Open');
      expect(res.body.data.items).toHaveLength(2);

      createdTaskName = res.body.data.name;
    });

    it('GET /api/resource/Task/:name - should fetch document with child tables', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/resource/Task/${createdTaskName}`)
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.name).toBe(createdTaskName);
      expect(res.body.data.title).toBe('API Integration Task');
      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.items[0].item_name).toBe('Subtask 1 via API');
    });

    it('PUT /api/resource/Task/:name - should update document and run hooks', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/resource/Task/${createdTaskName}`)
        .send({
          description: 'Updated via PUT',
          progress: 100, // Should auto-trigger completed status in TaskDocument
        })
        .expect(200);

      expect(res.body.data.description).toBe('Updated via PUT');
      expect(res.body.data.progress).toBe(100);
      expect(res.body.data.status).toBe('Completed');
      expect(res.body.data.is_completed).toBe(1);
    });

    it('GET /api/resource/Task - should list documents with filters and fields', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Task')
        .query({
          fields: JSON.stringify(['name', 'title', 'status', 'progress']),
          filters: JSON.stringify({ status: 'Completed' }),
        })
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0].status).toBe('Completed');
      expect(res.body.data[0]).toHaveProperty('name');
      expect(res.body.data[0]).toHaveProperty('title');
    });

    it('DELETE /api/resource/Task/:name - should delete document', async () => {
      await request(app.getHttpServer())
        .delete(`/api/resource/Task/${createdTaskName}`)
        .expect(200);

      // Verify it's no longer found
      await request(app.getHttpServer())
        .get(`/api/resource/Task/${createdTaskName}`)
        .expect(404);
    });
  });

  describe('Role-Based Permissions Enforcement', () => {
    beforeAll(async () => {
      // Define a restricted DocType
      const confidentialDocType: DocType = {
        name: 'ConfidentialReport',
        fields: [
          { fieldname: 'title', label: 'Title', fieldtype: 'Data', reqd: true },
          { fieldname: 'content', label: 'Content', fieldtype: 'Text' },
        ],
        permissions: [
          { role: 'Auditor', read: true, write: true, create: true },
          { role: 'System Manager', read: true, write: true, create: true, delete: true },
        ],
      };

      registry.register(confidentialDocType);
      await syncService.syncDocType(confidentialDocType);

      // Seed a user with 'Auditor' role
      const user = docService.newDoc('User', {
        email: 'auditor@company.com',
        first_name: 'Audit',
        last_name: 'User',
        roles: [{ role: 'Auditor' }],
      });
      await user.insert();

      // Seed another user with 'Employee' role only
      const employee = docService.newDoc('User', {
        email: 'emp@company.com',
        first_name: 'Regular',
        last_name: 'Employee',
        roles: [{ role: 'Employee' }],
      });
      await employee.insert();
    });

    it('should deny unauthorized user without required role', async () => {
      await request(app.getHttpServer())
        .post('/api/resource/ConfidentialReport')
        .set('x-frappe-user', 'emp@company.com')
        .send({ title: 'Top Secret' })
        .expect(403);
    });

    it('should allow authorized user with Auditor role', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/resource/ConfidentialReport')
        .set('x-frappe-user', 'auditor@company.com')
        .send({ title: 'Audit Report 2026', content: 'Clean audit' })
        .expect(201);

      expect(res.body.data.title).toBe('Audit Report 2026');
    });

    it('should allow Administrator access to any resource', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/ConfidentialReport')
        .set('x-frappe-user', 'Administrator')
        .expect(200);

      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('Whitelisted RPC Methods (/api/method/:methodName)', () => {
    it('GET /api/method/ping - should respond with pong', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/ping')
        .expect(200);

      expect(res.body).toEqual({ message: 'pong' });
    });

    it('GET /api/method/frappe.get_meta - should return DocType schema', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.get_meta')
        .query({ doctype: 'Task' })
        .expect(200);

      expect(res.body.message).toBeDefined();
      expect(res.body.message.name).toBe('Task');
      expect(res.body.message.fields.length).toBeGreaterThan(5);
    });

    it('should invoke custom registered RPC method', async () => {
      // Register custom method at runtime
      methodRegistry.register(
        'calculator.add',
        (params) => {
          return Number(params.a) + Number(params.b);
        },
        { isPublic: true },
      );

      const res = await request(app.getHttpServer())
        .post('/api/method/calculator.add')
        .send({ a: 15, b: 27 })
        .expect(201);

      expect(res.body).toEqual({ message: 42 });
    });

    it('should return 404 for unknown RPC method', async () => {
      await request(app.getHttpServer())
        .get('/api/method/unknown.method')
        .expect(404);
    });
  });
});
