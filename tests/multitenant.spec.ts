import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';
import { SiteManagerService } from '../src/tenant/site-manager.service';
import { SiteContextService } from '../src/tenant/site-context.service';
import { SiteResolverService } from '../src/tenant/site-resolver.service';
import { SiteStorageService } from '../src/tenant/site-storage.service';
import { DocumentService } from '../src/document/document.service';
import { QueueService } from '../src/async/queue.service';

describe('Multi-Tenant Site Support (Phases 1 - 6)', () => {
  let app: INestApplication;
  let siteManager: SiteManagerService;
  let siteContext: SiteContextService;
  let siteResolver: SiteResolverService;
  let siteStorage: SiteStorageService;
  let docService: DocumentService;
  let queueService: QueueService;

  const testSitesDir = path.join(process.cwd(), 'scratch_sites_test');

  beforeAll(async () => {
    // Set custom sites path for isolated test execution
    process.env.SITES_PATH = testSitesDir;
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    if (fs.existsSync(testSitesDir)) {
      fs.rmSync(testSitesDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testSitesDir, { recursive: true });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    siteManager = moduleRef.get<SiteManagerService>(SiteManagerService);
    siteContext = moduleRef.get<SiteContextService>(SiteContextService);
    siteResolver = moduleRef.get<SiteResolverService>(SiteResolverService);
    siteStorage = moduleRef.get<SiteStorageService>(SiteStorageService);
    docService = moduleRef.get<DocumentService>(DocumentService);
    queueService = moduleRef.get<QueueService>(QueueService);

    siteResolver.setSitesPath(testSitesDir);
  });

  afterAll(async () => {
    await app.close();
    if (fs.existsSync(testSitesDir)) {
      fs.rmSync(testSitesDir, { recursive: true, force: true });
    }
  });

  describe('Site Lifecycle Operations', () => {
    it('should create multiple independent sites with isolated databases', async () => {
      const alphaCtx = await siteManager.createSite({ sitename: 'alpha.local', dbType: 'sqlite3' });
      const betaCtx = await siteManager.createSite({ sitename: 'beta.local', dbType: 'sqlite3' });

      expect(alphaCtx.site).toBe('alpha.local');
      expect(betaCtx.site).toBe('beta.local');

      // Verify site folders & configs created
      expect(fs.existsSync(path.join(testSitesDir, 'alpha.local', 'site_config.json'))).toBe(true);
      expect(fs.existsSync(path.join(testSitesDir, 'beta.local', 'site_config.json'))).toBe(true);

      // Verify listing sites
      const sites = siteManager.listSites();
      expect(sites).toContain('alpha.local');
      expect(sites).toContain('beta.local');
    });

    it('should disallow duplicate site creation unless forced', async () => {
      await expect(
        siteManager.createSite({ sitename: 'alpha.local', dbType: 'sqlite3' }),
      ).rejects.toThrow(/already exists/);
    });
  });

  describe('Complete Database & Data Isolation', () => {
    it('should isolate documents between tenants completely', async () => {
      const alphaCtx = siteResolver.resolveSiteContext('alpha.local');
      const betaCtx = siteResolver.resolveSiteContext('beta.local');

      // 1. Create task in alpha.local
      await siteContext.run(alphaCtx, async () => {
        expect(siteContext.getCurrentSite()).toBe('alpha.local');
        const taskA = docService.newDoc('Task', {
          title: 'Mission for Alpha Tenant',
          priority: 'High',
          status: 'Open',
        });
        await taskA.insert();
      });

      // 2. Create task in beta.local
      await siteContext.run(betaCtx, async () => {
        expect(siteContext.getCurrentSite()).toBe('beta.local');
        const taskB = docService.newDoc('Task', {
          title: 'Mission for Beta Tenant',
          priority: 'Low',
          status: 'Completed',
        });
        await taskB.insert();
      });

      // 3. Verify alpha.local only sees its own tasks
      await siteContext.run(alphaCtx, async () => {
        const tasks = await docService.getList('Task');
        expect(tasks.length).toBe(1);
        expect(tasks[0].title).toBe('Mission for Alpha Tenant');
      });

      // 4. Verify beta.local only sees its own tasks
      await siteContext.run(betaCtx, async () => {
        const tasks = await docService.getList('Task');
        expect(tasks.length).toBe(1);
        expect(tasks[0].title).toBe('Mission for Beta Tenant');
      });
    });
  });

  describe('HTTP Request Routing via Headers & Host', () => {
    it('should route REST requests to alpha.local using X-Frappe-Site-Name header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Task')
        .set('x-frappe-user', 'Administrator')
        .set('x-frappe-site-name', 'alpha.local')
        .expect(200);

      expect(res.headers['x-frappe-site-name']).toBe('alpha.local');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Mission for Alpha Tenant');
    });

    it('should route REST requests to beta.local using X-Frappe-Site-Name header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Task')
        .set('x-frappe-user', 'Administrator')
        .set('x-frappe-site-name', 'beta.local')
        .expect(200);

      expect(res.headers['x-frappe-site-name']).toBe('beta.local');
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].title).toBe('Mission for Beta Tenant');
    });

    it('should route REST requests using Host header matching', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Task')
        .set('x-frappe-user', 'Administrator')
        .set('Host', 'alpha.local:3000')
        .expect(200);

      expect(res.headers['x-frappe-site-name']).toBe('alpha.local');
      expect(res.body.data[0].title).toBe('Mission for Alpha Tenant');
    });
  });

  describe('Site Storage Isolation', () => {
    it('should store and retrieve files in tenant-specific directories', async () => {
      const alphaCtx = siteResolver.resolveSiteContext('alpha.local');
      const betaCtx = siteResolver.resolveSiteContext('beta.local');

      // Save file for Alpha
      await siteContext.run(alphaCtx, async () => {
        await siteStorage.saveFile('tenant_info.txt', 'Secret Key for Alpha');
      });

      // Save file for Beta
      await siteContext.run(betaCtx, async () => {
        await siteStorage.saveFile('tenant_info.txt', 'Secret Key for Beta');
      });

      // Read back from Alpha
      await siteContext.run(alphaCtx, async () => {
        const fileContent = await siteStorage.getFile('tenant_info.txt');
        expect(fileContent?.toString()).toBe('Secret Key for Alpha');
      });

      // Read back from Beta
      await siteContext.run(betaCtx, async () => {
        const fileContent = await siteStorage.getFile('tenant_info.txt');
        expect(fileContent?.toString()).toBe('Secret Key for Beta');
      });
    });
  });

  describe('Background Queue Multi-Tenant Execution', () => {
    it('should execute background job inside the originating tenant context', async () => {
      const alphaCtx = siteResolver.resolveSiteContext('alpha.local');
      let executedSite: string | undefined;
      let taskFoundInsideWorker: any;

      queueService.registerWorker('test_tenant_job', async (data) => {
        executedSite = siteContext.getCurrentSite();
        // Should be able to query alpha's DB
        const tasks = await docService.getList('Task');
        taskFoundInsideWorker = tasks[0];
      });

      // Enqueue job while inside alpha.local context
      await siteContext.run(alphaCtx, async () => {
        await queueService.enqueue('test_tenant_job', { action: 'verify' });
      });

      // Wait for next tick execution of in-memory queue
      await new Promise((r) => setTimeout(r, 50));

      expect(executedSite).toBe('alpha.local');
      expect(taskFoundInsideWorker).toBeDefined();
      expect(taskFoundInsideWorker.title).toBe('Mission for Alpha Tenant');
    });
  });

  describe('Site Migration & Drop', () => {
    it('should migrate site schema without error', async () => {
      const result = await siteManager.migrateSite('alpha.local');
      expect(result).toContain('alpha.local');
      expect(result).toContain('migrated successfully');
    });

    it('should drop site and purge its files and connection', async () => {
      await siteManager.dropSite('beta.local');
      const sites = siteManager.listSites();
      expect(sites).not.toContain('beta.local');
      expect(fs.existsSync(path.join(testSitesDir, 'beta.local'))).toBe(false);
    });
  });
});
