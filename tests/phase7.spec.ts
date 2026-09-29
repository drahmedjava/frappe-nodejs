import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Phase 7 UI Shell (Desk) Tests', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /app - should serve the Frappe Desk single page application', async () => {
    const res = await request(app.getHttpServer())
      .get('/app')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(res.text).toContain('Frappe');
    expect(res.text).toContain('NodeJS');
    expect(res.text).toContain('Report Builder');
    expect(res.text).toContain('doctypeList');
  });

  it('GET /app/Task - should support client-side deep routing for list view', async () => {
    const res = await request(app.getHttpServer())
      .get('/app/Task')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(res.text).toContain('Frappe');
  });

  it('GET /app/Task/TASK-00001 - should support client-side deep routing for form view', async () => {
    const res = await request(app.getHttpServer())
      .get('/app/Task/TASK-00001')
      .expect(200)
      .expect('Content-Type', /text\/html/);

    expect(res.text).toContain('Frappe');
  });

  it('GET /api/method/frappe.get_doctypes - should return list of navigable DocTypes for Desk sidebar', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/method/frappe.get_doctypes')
      .expect(200);

    expect(res.body.message).toBeDefined();
    expect(Array.isArray(res.body.message)).toBe(true);
    const names = res.body.message.map((d: any) => d.name);
    expect(names).toContain('Task');
    expect(names).toContain('User');
    expect(names).toContain('Workflow');
    expect(names).toContain('ServerScript');
  });
});
