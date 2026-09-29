import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, NotFoundException } from '@nestjs/common';
import request from 'supertest';
import * as path from 'path';
import * as fs from 'fs';
import { AppModule } from '../src/app.module';
import { SiteManagerService } from '../src/tenant/site-manager.service';
import { SiteContextService } from '../src/tenant/site-context.service';
import { SiteResolverService } from '../src/tenant/site-resolver.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocumentService } from '../src/document/document.service';
import { DatabaseService } from '../src/database/database.service';
import { DocType } from '../src/meta/types';

describe('Per-Table Tenancy & Two-Tier Hybrid Isolation', () => {
  let app: INestApplication;
  let siteManager: SiteManagerService;
  let siteContext: SiteContextService;
  let siteResolver: SiteResolverService;
  let registry: DocTypeRegistryService;
  let schemaSync: SchemaSyncService;
  let docService: DocumentService;
  let db: DatabaseService;

  const testSitesDir = path.join(process.cwd(), 'scratch_per_table_sites_test');

  const tenantCustomerDocType: DocType = {
    name: 'TenantCustomer',
    module: 'CRM',
    isSingle: false,
    isChildTable: false,
    isSubmittable: false,
    isTenantScoped: true, // Tenant scoped!
    namingRule: 'field',
    autoname: 'customer_code',
    fields: [
      { fieldname: 'customer_code', label: 'Code', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'customer_name', label: 'Name', fieldtype: 'Data', reqd: true },
      { fieldname: 'email', label: 'Email', fieldtype: 'Data' },
    ],
    permissions: [
      { role: 'Administrator', read: true, write: true, create: true, delete: true },
      { role: 'All', read: true, write: true, create: true, delete: true },
    ],
  };

  const globalTagDocType: DocType = {
    name: 'GlobalTag',
    module: 'Core',
    isSingle: false,
    isChildTable: false,
    isSubmittable: false,
    isTenantScoped: false, // Global shared across tenants
    namingRule: 'field',
    autoname: 'tag_name',
    fields: [
      { fieldname: 'tag_name', label: 'Tag Name', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'color', label: 'Color', fieldtype: 'Data' },
    ],
    permissions: [
      { role: 'Administrator', read: true, write: true, create: true, delete: true },
      { role: 'All', read: true, write: true, create: true, delete: true },
    ],
  };

  beforeAll(async () => {
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
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    docService = moduleRef.get<DocumentService>(DocumentService);
    db = moduleRef.get<DatabaseService>(DatabaseService);

    siteResolver.setSitesPath(testSitesDir);

    // Register DocTypes
    registry.register(tenantCustomerDocType);
    registry.register(globalTagDocType);

    // Sync schema to default db
    await schemaSync.syncDocType(tenantCustomerDocType);
    await schemaSync.syncDocType(globalTagDocType);
  });

  afterAll(async () => {
    await app.close();
    if (fs.existsSync(testSitesDir)) {
      fs.rmSync(testSitesDir, { recursive: true, force: true });
    }
  });

  describe('1. Schema Sync & Column Generation', () => {
    it('should generate tenant_id column for tenant-scoped DocType', async () => {
      const knex = db.getKnex();
      const colInfo = await knex('tabTenantCustomer').columnInfo();
      expect(colInfo).toHaveProperty('tenant_id');
      expect(colInfo).toHaveProperty('customer_name');
    });

    it('should NOT generate tenant_id column for global non-tenant DocType', async () => {
      const knex = db.getKnex();
      const colInfo = await knex('tabGlobalTag').columnInfo();
      expect(colInfo).not.toHaveProperty('tenant_id');
      expect(colInfo).toHaveProperty('tag_name');
    });

    it('should alter existing table to add tenant_id when isTenantScoped is enabled later', async () => {
      const dynamicDocType: DocType = {
        name: 'DynamicVendor',
        module: 'Purchasing',
        isSingle: false,
        isChildTable: false,
        isSubmittable: false,
        isTenantScoped: false,
        namingRule: 'field',
        autoname: 'vendor_code',
        fields: [{ fieldname: 'vendor_code', label: 'Code', fieldtype: 'Data', reqd: true, unique: true }],
      };

      registry.register(dynamicDocType);
      await schemaSync.syncDocType(dynamicDocType);

      const knex = db.getKnex();
      let cols = await knex('tabDynamicVendor').columnInfo();
      expect(cols).not.toHaveProperty('tenant_id');

      // Now update to tenant scoped and sync again
      dynamicDocType.isTenantScoped = true;
      registry.register(dynamicDocType);
      await schemaSync.syncDocType(dynamicDocType);

      cols = await knex('tabDynamicVendor').columnInfo();
      expect(cols).toHaveProperty('tenant_id');
    });
  });

  describe('2. Single Database Row-Level Partitioning & Auto-Scoping', () => {
    let customerAId: string;
    let customerBId: string;

    it('should automatically stamp tenant_id upon document insertion', async () => {
      // Create as tenant_A
      await siteContext.run({ site: 'default', tenantId: 'tenant_A' }, async () => {
        const docA = docService.newDoc('TenantCustomer', {
          customer_code: 'CUST-001',
          customer_name: 'Acme Corporation',
          email: 'info@acme.com',
        });
        await docA.insert();
        customerAId = docA.name;
        expect(docA.tenant_id).toBe('tenant_A');
      });

      // Create as tenant_B
      await siteContext.run({ site: 'default', tenantId: 'tenant_B' }, async () => {
        const docB = docService.newDoc('TenantCustomer', {
          customer_code: 'CUST-002',
          customer_name: 'Beta Industries',
          email: 'contact@beta.com',
        });
        await docB.insert();
        customerBId = docB.name;
        expect(docB.tenant_id).toBe('tenant_B');
      });

      // Direct DB verification
      const knex = db.getKnex();
      const rawRows = await knex('tabTenantCustomer').orderBy('name', 'asc');
      expect(rawRows.length).toBe(2);
      expect(rawRows[0].tenant_id).toBe('tenant_A');
      expect(rawRows[1].tenant_id).toBe('tenant_B');
    });

    it('should automatically isolate getList queries by active tenant', async () => {
      await siteContext.run({ site: 'default', tenantId: 'tenant_A' }, async () => {
        const listA = await docService.getList('TenantCustomer');
        expect(listA.length).toBe(1);
        expect(listA[0].name).toBe('CUST-001');
        expect(listA[0].customer_name).toBe('Acme Corporation');
      });

      await siteContext.run({ site: 'default', tenantId: 'tenant_B' }, async () => {
        const listB = await docService.getList('TenantCustomer');
        expect(listB.length).toBe(1);
        expect(listB[0].name).toBe('CUST-002');
        expect(listB[0].customer_name).toBe('Beta Industries');
      });
    });

    it('should allow getDoc for owned tenant and throw NotFoundException for foreign tenant', async () => {
      // Tenant A can access CUST-001
      await siteContext.run({ site: 'default', tenantId: 'tenant_A' }, async () => {
        const doc = await docService.getDoc('TenantCustomer', 'CUST-001');
        expect(doc.name).toBe('CUST-001');
        expect(doc.tenant_id).toBe('tenant_A');

        // Tenant A cannot access CUST-002 (tenant_B's document)
        await expect(docService.getDoc('TenantCustomer', 'CUST-002')).rejects.toThrow(NotFoundException);
      });

      // Tenant B can access CUST-002, but not CUST-001
      await siteContext.run({ site: 'default', tenantId: 'tenant_B' }, async () => {
        const doc = await docService.getDoc('TenantCustomer', 'CUST-002');
        expect(doc.name).toBe('CUST-002');
        expect(doc.tenant_id).toBe('tenant_B');

        await expect(docService.getDoc('TenantCustomer', 'CUST-001')).rejects.toThrow(NotFoundException);
      });
    });

    it('should give superadmin / system context visibility over all tenants', async () => {
      // Outside any tenant context (no tenantId set)
      await siteContext.run({ site: 'default' }, async () => {
        const listAll = await docService.getList('TenantCustomer');
        expect(listAll.length).toBe(2);

        const docA = await docService.getDoc('TenantCustomer', 'CUST-001');
        const docB = await docService.getDoc('TenantCustomer', 'CUST-002');
        expect(docA.tenant_id).toBe('tenant_A');
        expect(docB.tenant_id).toBe('tenant_B');
      });
    });

    it('should prevent cross-tenant mutation and tampering', async () => {
      await siteContext.run({ site: 'default', tenantId: 'tenant_A' }, async () => {
        // Attempting to delete tenant B's document via docService throws NotFoundException
        await expect(docService.deleteDoc('TenantCustomer', 'CUST-002')).rejects.toThrow(NotFoundException);

        // If an existing document object from another tenant is manipulated and saved
        const doc = docService.newDoc('TenantCustomer', {
          name: 'CUST-002',
          customer_code: 'CUST-002',
          customer_name: 'Hacked Name',
          tenant_id: 'tenant_B',
        });
        doc.isNew = false;
        await expect(doc.save()).rejects.toThrow(/Permission denied/);
      });
    });
  });

  describe('3. Global Reference Data Sharing', () => {
    it('should share non-tenant DocTypes across all tenants', async () => {
      // Create global tag as tenant_A
      await siteContext.run({ site: 'default', tenantId: 'tenant_A' }, async () => {
        const tag = docService.newDoc('GlobalTag', {
          tag_name: 'VIP-Account',
          color: '#ff0000',
        });
        await tag.insert();
      });

      // Tenant B can list and read the global tag
      await siteContext.run({ site: 'default', tenantId: 'tenant_B' }, async () => {
        const tags = await docService.getList('GlobalTag');
        expect(tags.some((t) => t.name === 'VIP-Account')).toBe(true);

        const tag = await docService.getDoc('GlobalTag', 'VIP-Account');
        expect(tag.tag_name).toBe('VIP-Account');
        expect(tag.color).toBe('#ff0000');
      });
    });
  });

  describe('4. REST HTTP Middleware & Header Resolution', () => {
    it('should scope REST API queries using X-Tenant-ID header', async () => {
      // Query as tenant_A
      const resA = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer')
        .set('X-Tenant-ID', 'tenant_A');

      expect(resA.status).toBe(200);
      expect(resA.headers['x-frappe-tenant-id']).toBe('tenant_A');
      expect(resA.body.data.length).toBe(1);
      expect(resA.body.data[0].name).toBe('CUST-001');

      // Query as tenant_B
      const resB = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer')
        .set('X-Frappe-Tenant-Id', 'tenant_B');

      expect(resB.status).toBe(200);
      expect(resB.headers['x-frappe-tenant-id']).toBe('tenant_B');
      expect(resB.body.data.length).toBe(1);
      expect(resB.body.data[0].name).toBe('CUST-002');
    });

    it('should return 404 when querying another tenant document via REST', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer/CUST-002')
        .set('X-Tenant-ID', 'tenant_A');

      expect(res.status).toBe(404);
    });

    it('should auto-stamp tenant on POST /api/resource/:doctype', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/resource/TenantCustomer')
        .set('X-Tenant-ID', 'tenant_A')
        .send({
          customer_code: 'CUST-003',
          customer_name: 'Third Customer for A',
          email: 'third@acme.com',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('CUST-003');

      // Verify tenant_B cannot see CUST-003
      const checkB = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer/CUST-003')
        .set('X-Tenant-ID', 'tenant_B');
      expect(checkB.status).toBe(404);

      // Verify tenant_A CAN see CUST-003
      const checkA = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer/CUST-003')
        .set('X-Tenant-ID', 'tenant_A');
      expect(checkA.status).toBe(200);
    });

    it('should resolve tenant from query param ?tenant_id=...', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer?tenant_id=tenant_B');

      expect(res.status).toBe(200);
      expect(res.headers['x-frappe-tenant-id']).toBe('tenant_B');
      expect(res.body.data.some((d: any) => d.name === 'CUST-002')).toBe(true);
      expect(res.body.data.every((d: any) => d.name !== 'CUST-001')).toBe(true);
    });
  });

  describe('5. Two-Tier Hybrid Isolation (Multi-Site + Multi-Tenant)', () => {
    it('should maintain independent databases per site AND row-level isolation per tenant', async () => {
      // Create two distinct physical sites
      const site1Ctx = await siteManager.createSite({ sitename: 'corp-site1.local', dbType: 'sqlite3' });
      const site2Ctx = await siteManager.createSite({ sitename: 'corp-site2.local', dbType: 'sqlite3' });

      // Ensure TenantCustomer is synced to both sites' DBs
      await siteContext.run(site1Ctx, async () => {
        await schemaSync.syncDocType(tenantCustomerDocType);
      });
      await siteContext.run(site2Ctx, async () => {
        await schemaSync.syncDocType(tenantCustomerDocType);
      });

      // 1. In Site 1, create records for tenant_alpha and tenant_beta
      const s1AlphaCtx = siteResolver.resolveSiteContext('corp-site1.local', 'tenant_alpha');
      await siteContext.run(s1AlphaCtx, async () => {
        const doc = docService.newDoc('TenantCustomer', {
          customer_code: 'S1-ALPHA-01',
          customer_name: 'Site 1 Customer Alpha',
          email: 'alpha@site1.corp',
        });
        await doc.insert();
      });

      const s1BetaCtx = siteResolver.resolveSiteContext('corp-site1.local', 'tenant_beta');
      await siteContext.run(s1BetaCtx, async () => {
        const doc = docService.newDoc('TenantCustomer', {
          customer_code: 'S1-BETA-01',
          customer_name: 'Site 1 Customer Beta',
          email: 'beta@site1.corp',
        });
        await doc.insert();
      });

      // 2. In Site 2, create record for tenant_alpha
      const s2AlphaCtx = siteResolver.resolveSiteContext('corp-site2.local', 'tenant_alpha');
      await siteContext.run(s2AlphaCtx, async () => {
        const doc = docService.newDoc('TenantCustomer', {
          customer_code: 'S2-ALPHA-01',
          customer_name: 'Site 2 Customer Alpha',
          email: 'alpha@site2.corp',
        });
        await doc.insert();
      });

      // 3. Verify Hybrid Two-Tier Isolation:

      // (a) Site 1 + Tenant Alpha: sees ONLY S1-ALPHA-01
      await siteContext.run(s1AlphaCtx, async () => {
        const list = await docService.getList('TenantCustomer');
        expect(list.length).toBe(1);
        expect(list[0].name).toBe('S1-ALPHA-01');

        await expect(docService.getDoc('TenantCustomer', 'S1-BETA-01')).rejects.toThrow(NotFoundException);
        await expect(docService.getDoc('TenantCustomer', 'S2-ALPHA-01')).rejects.toThrow(NotFoundException);
      });

      // (b) Site 1 + Tenant Beta: sees ONLY S1-BETA-01
      await siteContext.run(s1BetaCtx, async () => {
        const list = await docService.getList('TenantCustomer');
        expect(list.length).toBe(1);
        expect(list[0].name).toBe('S1-BETA-01');

        await expect(docService.getDoc('TenantCustomer', 'S1-ALPHA-01')).rejects.toThrow(NotFoundException);
        await expect(docService.getDoc('TenantCustomer', 'S2-ALPHA-01')).rejects.toThrow(NotFoundException);
      });

      // (c) Site 2 + Tenant Alpha: sees ONLY S2-ALPHA-01 (not Site 1's tenant_alpha records!)
      await siteContext.run(s2AlphaCtx, async () => {
        const list = await docService.getList('TenantCustomer');
        expect(list.length).toBe(1);
        expect(list[0].name).toBe('S2-ALPHA-01');

        await expect(docService.getDoc('TenantCustomer', 'S1-ALPHA-01')).rejects.toThrow(NotFoundException);
        await expect(docService.getDoc('TenantCustomer', 'S1-BETA-01')).rejects.toThrow(NotFoundException);
      });

      // (d) HTTP verification of both X-Frappe-Site-Name and X-Tenant-ID headers simultaneously
      const httpRes = await request(app.getHttpServer())
        .get('/api/resource/TenantCustomer')
        .set('X-Frappe-Site-Name', 'corp-site1.local')
        .set('X-Tenant-ID', 'tenant_alpha');

      expect(httpRes.status).toBe(200);
      expect(httpRes.headers['x-frappe-site-name']).toBe('corp-site1.local');
      expect(httpRes.headers['x-frappe-tenant-id']).toBe('tenant_alpha');
      expect(httpRes.body.data.length).toBe(1);
      expect(httpRes.body.data[0].name).toBe('S1-ALPHA-01');
    });
  });
});
