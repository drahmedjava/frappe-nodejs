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

describe('Phase 4 Row-Level Security & User Permissions Tests', () => {
  let app: INestApplication;
  let syncService: SchemaSyncService;
  let registry: DocTypeRegistryService;
  let docService: DocumentService;

  let aliceTaskName: string;
  let bobTaskName: string;

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

    await syncService.syncAll();

    // 1. Create Users: Alice and Bob
    const alice = docService.newDoc('User', {
      email: 'alice@company.com',
      first_name: 'Alice',
      roles: [{ role: 'All' }],
    });
    await alice.insert();

    const bob = docService.newDoc('User', {
      email: 'bob@company.com',
      first_name: 'Bob',
      roles: [{ role: 'All' }],
    });
    await bob.insert();

    // 2. Create Tasks assigned to Alice and Bob
    const t1 = docService.newDoc('Task', {
      title: 'Alice Task',
      assigned_to: 'alice@company.com',
    });
    await t1.insert();
    aliceTaskName = t1.name;

    const t2 = docService.newDoc('Task', {
      title: 'Bob Task',
      assigned_to: 'bob@company.com',
    });
    await t2.insert();
    bobTaskName = t2.name;

    // 3. Create UserPermission restricting Alice to only her User link
    const userPerm = docService.newDoc('UserPermission', {
      user: 'alice@company.com',
      allow: 'User',
      for_value: 'alice@company.com',
    });
    await userPerm.insert();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('User Permissions Link-Field Query Injection', () => {
    it('should only return rows matching UserPermission in list view', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Task')
        .set('x-frappe-user', 'alice@company.com')
        .expect(200);

      expect(res.body.data).toBeDefined();
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe(aliceTaskName);
      expect(res.body.data[0].assigned_to).toBe('alice@company.com');
    });

    it('should deny GET access to individual doc violating UserPermission', async () => {
      // Alice tries to get Bob's task directly
      await request(app.getHttpServer())
        .get(`/api/resource/Task/${bobTaskName}`)
        .set('x-frappe-user', 'alice@company.com')
        .expect(403);
    });

    it('should allow GET access to doc conforming to UserPermission', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/resource/Task/${aliceTaskName}`)
        .set('x-frappe-user', 'alice@company.com')
        .expect(200);

      expect(res.body.data.name).toBe(aliceTaskName);
    });
  });

  describe('If Owner Permission Rules', () => {
    let aliceNoteName: string;

    beforeAll(async () => {
      const personalNoteMeta: DocType = {
        name: 'PersonalNote',
        fields: [
          { fieldname: 'title', label: 'Title', fieldtype: 'Data', reqd: true },
          { fieldname: 'body', label: 'Body', fieldtype: 'Text' },
        ],
        permissions: [
          { role: 'Note Taker', read: true, write: true, create: true, if_owner: true },
          { role: 'System Manager', read: true, write: true, create: true, delete: true },
        ],
      };

      registry.register(personalNoteMeta);
      await syncService.syncDocType(personalNoteMeta);

      // Give Charlie and Dave 'Note Taker' role
      const charlie = docService.newDoc('User', {
        email: 'charlie@company.com',
        roles: [{ role: 'Note Taker' }],
      });
      await charlie.insert();

      const dave = docService.newDoc('User', {
        email: 'dave@company.com',
        roles: [{ role: 'Note Taker' }],
      });
      await dave.insert();

      // Charlie creates a note
      const note = docService.newDoc('PersonalNote', {
        title: "Charlie's Secret Note",
        body: 'Confidential thoughts',
      });
      await note.insert('charlie@company.com');
      aliceNoteName = note.name;
    });

    it('should only list notes owned by the current user when if_owner is set', async () => {
      // Dave lists notes
      const res = await request(app.getHttpServer())
        .get('/api/resource/PersonalNote')
        .set('x-frappe-user', 'dave@company.com')
        .expect(200);

      expect(res.body.data).toHaveLength(0);

      // Charlie lists notes
      const charlieRes = await request(app.getHttpServer())
        .get('/api/resource/PersonalNote')
        .set('x-frappe-user', 'charlie@company.com')
        .expect(200);

      expect(charlieRes.body.data).toHaveLength(1);
      expect(charlieRes.body.data[0].name).toBe(aliceNoteName);
    });

    it('should forbid user from reading another users document when if_owner applies', async () => {
      await request(app.getHttpServer())
        .get(`/api/resource/PersonalNote/${aliceNoteName}`)
        .set('x-frappe-user', 'dave@company.com')
        .expect(403);
    });
  });

  describe('Field-Level Permissions (permlevel)', () => {
    let employeeProfileName: string;

    beforeAll(async () => {
      const employeeProfileMeta: DocType = {
        name: 'EmployeeProfile',
        fields: [
          { fieldname: 'employee_name', label: 'Name', fieldtype: 'Data', permlevel: 0 },
          { fieldname: 'department', label: 'Department', fieldtype: 'Data', permlevel: 0 },
          { fieldname: 'salary', label: 'Salary', fieldtype: 'Currency', permlevel: 1 },
        ],
        permissions: [
          { role: 'Employee', read: true, permlevel: 0 },
          { role: 'HR Manager', read: true, permlevel: 1 },
          { role: 'System Manager', read: true, write: true, create: true },
        ],
      };

      registry.register(employeeProfileMeta);
      await syncService.syncDocType(employeeProfileMeta);

      const hrUser = docService.newDoc('User', {
        email: 'hr@company.com',
        roles: [{ role: 'HR Manager' }],
      });
      await hrUser.insert();

      const regularEmp = docService.newDoc('User', {
        email: 'regular@company.com',
        roles: [{ role: 'Employee' }],
      });
      await regularEmp.insert();

      const profile = docService.newDoc('EmployeeProfile', {
        employee_name: 'John Doe',
        department: 'Engineering',
        salary: 120000,
      });
      await profile.insert();
      employeeProfileName = profile.name;
    });

    it('should redact permlevel 1 fields for standard Employee', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/resource/EmployeeProfile/${employeeProfileName}`)
        .set('x-frappe-user', 'regular@company.com')
        .expect(200);

      expect(res.body.data.employee_name).toBe('John Doe');
      expect(res.body.data.department).toBe('Engineering');
      // Salary must be redacted!
      expect(res.body.data.salary).toBeUndefined();
    });

    it('should include permlevel 1 fields for HR Manager', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/resource/EmployeeProfile/${employeeProfileName}`)
        .set('x-frappe-user', 'hr@company.com')
        .expect(200);

      expect(res.body.data.employee_name).toBe('John Doe');
      expect(res.body.data.department).toBe('Engineering');
      // Salary must be visible for HR Manager
      expect(res.body.data.salary).toBe(120000);
    });
  });
});
