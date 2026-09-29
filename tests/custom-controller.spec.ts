import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Controller, Post, Body, Injectable } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BaseDocument } from '../src/document/base-document';
import { DocController } from '../src/document/document-controller.registry';
import { BaseCustomController } from '../src/api/base-custom.controller';
import { Whitelist } from '../src/api/decorators/whitelist.decorator';
import { DocumentService } from '../src/document/document.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { SiteContextService } from '../src/tenant/site-context.service';
import { DocType } from '../src/meta/types';
import { AuthUser } from '../src/auth/types';

// -------------------------------------------------------------
// 1. Custom Document Controller (subclassing BaseDocument)
//    Uses injected DocumentService to access Customer & AuditLog
// -------------------------------------------------------------
@DocController('CustomOrder')
export class CustomOrderDocument extends BaseDocument {
  override async validate(): Promise<void> {
    const customerCode = this.get('customer');
    if (customerCode) {
      // Access another DocType (Customer) via injected DocumentService
      const customer = await this.getDoc('CustomCustomer', customerCode);
      if (customer.get('is_frozen') === 1 || customer.get('is_frozen') === true) {
        throw new Error(`Customer "${customerCode}" is frozen. Cannot create orders.`);
      }
    }
  }

  override async after_save(): Promise<void> {
    // Access another DocType (AuditLog) via injected DocumentService
    const log = this.newDoc('CustomAuditLog', {
      order_name: this.name,
      action: 'Saved Order',
      total_amount: this.get('total_amount'),
    });
    await log.insert();
  }

  // Custom business method callable via REST or RPC
  async cancelOrder(params: { reason?: string }, context?: { user: AuthUser }): Promise<any> {
    this.set('status', 'Cancelled');
    this.set('cancellation_reason', params?.reason || 'No reason provided');
    await this.save();

    // Create an audit entry for the cancellation
    const log = this.newDoc('CustomAuditLog', {
      order_name: this.name,
      action: `Cancelled: ${params?.reason || 'No reason'}`,
      total_amount: this.get('total_amount'),
    });
    await log.insert();

    return {
      order: this.name,
      status: this.get('status'),
      reason: this.get('cancellation_reason'),
    };
  }
}

// -------------------------------------------------------------
// 2. Custom NestJS Controller (extending BaseCustomController)
//    Injects DocumentService and provides custom business endpoints
// -------------------------------------------------------------
@Controller('api/custom/billing')
export class CustomBillingController extends BaseCustomController {
  constructor(docService: DocumentService, registry: DocTypeRegistryService) {
    super(docService, registry);
  }

  @Post('bulk-close-orders')
  async bulkClose(@Body() body: { customer: string }) {
    // Queries all orders for a customer across any DocType
    const orders = await this.getList('CustomOrder', {
      filters: { customer: body.customer, status: 'Open' },
    });

    for (const orderRow of orders) {
      const doc = await this.getDoc('CustomOrder', orderRow.name);
      doc.set('status', 'Closed');
      await doc.save();
    }

    return { closedCount: orders.length };
  }
}

// -------------------------------------------------------------
// 3. Custom Service with @Whitelist() RPC Method
// -------------------------------------------------------------
@Injectable()
export class CustomFinanceService {
  constructor(private readonly docService: DocumentService) {}

  @Whitelist({ name: 'finance.calculate_order_tax', isPublic: false })
  async calculateTax(params: { orderName: string; taxRate: number }) {
    // Uses DocumentService to retrieve order
    const order = await this.docService.getDoc('CustomOrder', params.orderName);
    const amount = Number(order.get('total_amount')) || 0;
    const tax = amount * (params.taxRate || 0.1);
    return {
      order: order.name,
      amount,
      tax,
      total: amount + tax,
    };
  }
}

describe('Custom Controller & DocumentService Injection Tests', () => {
  let app: INestApplication;
  let docService: DocumentService;
  let registry: DocTypeRegistryService;
  let schemaSync: SchemaSyncService;
  let siteContext: SiteContextService;

  // Metadata for custom DocTypes
  const customCustomerMeta: DocType = {
    name: 'CustomCustomer',
    namingRule: 'field',
    autoname: 'customer_code',
    isTenantScoped: true,
    fields: [
      { fieldname: 'customer_code', label: 'Code', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'customer_name', label: 'Name', fieldtype: 'Data', reqd: true },
      { fieldname: 'is_frozen', label: 'Frozen', fieldtype: 'Check', default: 0 },
    ],
    permissions: [{ role: 'All', read: true, write: true, create: true, delete: true }],
  };

  const customOrderMeta: DocType = {
    name: 'CustomOrder',
    namingRule: 'field',
    autoname: 'order_id',
    isTenantScoped: true,
    fields: [
      { fieldname: 'order_id', label: 'Order ID', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'customer', label: 'Customer', fieldtype: 'Link', options: 'CustomCustomer', reqd: true },
      { fieldname: 'total_amount', label: 'Total Amount', fieldtype: 'Currency', default: 0 },
      { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: ['Open', 'Closed', 'Cancelled'], default: 'Open' },
      { fieldname: 'cancellation_reason', label: 'Reason', fieldtype: 'Data' },
    ],
    permissions: [{ role: 'All', read: true, write: true, create: true, delete: true }],
  };

  const customAuditLogMeta: DocType = {
    name: 'CustomAuditLog',
    namingRule: 'hash',
    autoname: 'hash',
    isTenantScoped: true,
    fields: [
      { fieldname: 'order_name', label: 'Order Name', fieldtype: 'Data', reqd: true },
      { fieldname: 'action', label: 'Action', fieldtype: 'Data', reqd: true },
      { fieldname: 'total_amount', label: 'Total Amount', fieldtype: 'Currency' },
    ],
    permissions: [{ role: 'All', read: true, write: true, create: true, delete: true }],
  };

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [CustomBillingController],
      providers: [CustomFinanceService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    docService = moduleRef.get<DocumentService>(DocumentService);
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    siteContext = moduleRef.get<SiteContextService>(SiteContextService);

    // Register DocTypes
    registry.register(customCustomerMeta);
    registry.register(customOrderMeta);
    registry.register(customAuditLogMeta);

    // Sync schema
    await schemaSync.syncDocType(customCustomerMeta);
    await schemaSync.syncDocType(customOrderMeta);
    await schemaSync.syncDocType(customAuditLogMeta);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Custom Document Controller accessing other DocTypes', () => {
    it('should validate against Customer DocType and create AuditLog DocType on save', async () => {
      // 1. Create an active customer
      const customer = docService.newDoc('CustomCustomer', {
        customer_code: 'CUST-ACTIVE-01',
        customer_name: 'Acme Active Corp',
        is_frozen: 0,
      });
      await customer.insert();

      // 2. Create order using CustomOrderDocument
      const order = docService.newDoc('CustomOrder', {
        order_id: 'ORD-1001',
        customer: 'CUST-ACTIVE-01',
        total_amount: 500,
        status: 'Open',
      });

      // Verify that CustomOrder controller class was resolved by DocumentControllerRegistry
      expect(order).toBeInstanceOf(CustomOrderDocument);

      await order.insert();

      // 3. Verify that after_save() created an audit log entry in CustomAuditLog
      const auditLogs = await docService.getList('CustomAuditLog', {
        filters: { order_name: 'ORD-1001' },
      });
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].action).toBe('Saved Order');
      expect(auditLogs[0].total_amount).toBe(500);
    });

    it('should reject order creation when customer is frozen (inter-doctype validation)', async () => {
      // Create a frozen customer
      const frozenCustomer = docService.newDoc('CustomCustomer', {
        customer_code: 'CUST-FROZEN-01',
        customer_name: 'Frozen Ltd',
        is_frozen: 1,
      });
      await frozenCustomer.insert();

      // Attempt order
      const order = docService.newDoc('CustomOrder', {
        order_id: 'ORD-1002',
        customer: 'CUST-FROZEN-01',
        total_amount: 1200,
      });

      await expect(order.insert()).rejects.toThrow(/Customer "CUST-FROZEN-01" is frozen/);
    });
  });

  describe('2. Custom Document Methods Invoked via REST & RPC', () => {
    it('should execute custom document method via POST /api/resource/:doctype/:name/:method', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/resource/CustomOrder/ORD-1001/cancelOrder')
        .send({ reason: 'Client changed mind' })
        .expect(201);

      expect(res.body.data.status).toBe('Cancelled');
      expect(res.body.data.reason).toBe('Client changed mind');

      // Verify DB state
      const updatedOrder = await docService.getDoc('CustomOrder', 'ORD-1001');
      expect(updatedOrder.get('status')).toBe('Cancelled');
      expect(updatedOrder.get('cancellation_reason')).toBe('Client changed mind');

      // Verify Audit Log entry created by cancelOrder method
      const auditLogs = await docService.getList('CustomAuditLog', {
        filters: { order_name: 'ORD-1001' },
      });
      expect(auditLogs.length).toBe(3);
      expect(auditLogs.some((l) => l.action === 'Cancelled: Client changed mind')).toBe(true);
    });

    it('should execute custom document method via RPC POST /api/method/run_doc_method', async () => {
      // Create another order to cancel via RPC
      const order2 = docService.newDoc('CustomOrder', {
        order_id: 'ORD-1003',
        customer: 'CUST-ACTIVE-01',
        total_amount: 800,
        status: 'Open',
      });
      await order2.insert();

      const res = await request(app.getHttpServer())
        .post('/api/method/run_doc_method')
        .set('x-frappe-user', 'Administrator')
        .send({
          dt: 'CustomOrder',
          dn: 'ORD-1003',
          method: 'cancelOrder',
          args: { reason: 'Cancelled via Frappe RPC' },
        })
        .expect(201);

      expect(res.body.message.status).toBe('Cancelled');
      expect(res.body.message.reason).toBe('Cancelled via Frappe RPC');
    });
  });

  describe('3. Custom NestJS Controller extending BaseCustomController', () => {
    it('should execute bulk business logic across all DocTypes via injected DocumentService', async () => {
      // Create two open orders for customer CUST-ACTIVE-01
      const ordA = docService.newDoc('CustomOrder', {
        order_id: 'ORD-BULK-A',
        customer: 'CUST-ACTIVE-01',
        total_amount: 100,
        status: 'Open',
      });
      await ordA.insert();

      const ordB = docService.newDoc('CustomOrder', {
        order_id: 'ORD-BULK-B',
        customer: 'CUST-ACTIVE-01',
        total_amount: 200,
        status: 'Open',
      });
      await ordB.insert();

      // Call custom NestJS controller endpoint
      const res = await request(app.getHttpServer())
        .post('/api/custom/billing/bulk-close-orders')
        .send({ customer: 'CUST-ACTIVE-01' })
        .expect(201);

      expect(res.body.closedCount).toBe(2);

      // Verify both are now Closed
      const checkA = await docService.getDoc('CustomOrder', 'ORD-BULK-A');
      const checkB = await docService.getDoc('CustomOrder', 'ORD-BULK-B');
      expect(checkA.get('status')).toBe('Closed');
      expect(checkB.get('status')).toBe('Closed');
    });
  });

  describe('4. @Whitelist() RPC Method Integration', () => {
    it('should discover and execute @Whitelist() method accessing DocumentService', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/finance.calculate_order_tax')
        .set('x-frappe-user', 'Administrator')
        .send({ orderName: 'ORD-1001', taxRate: 0.15 })
        .expect(201);

      expect(res.body.message.order).toBe('ORD-1001');
      expect(res.body.message.amount).toBe(500);
      expect(res.body.message.tax).toBe(75);
      expect(res.body.message.total).toBe(575);
    });
  });

  describe('5. Multi-Tenant Auto-Scoping within Custom Controllers', () => {
    it('should respect active tenant when custom controller queries and mutates documents', async () => {
      // In tenant_1 context: create an order
      await siteContext.run({ site: 'default', tenantId: 'tenant_1' }, async () => {
        const cust1 = docService.newDoc('CustomCustomer', {
          customer_code: 'CUST-T1',
          customer_name: 'Tenant 1 Customer',
        });
        await cust1.insert();

        const ord1 = docService.newDoc('CustomOrder', {
          order_id: 'ORD-T1-01',
          customer: 'CUST-T1',
          total_amount: 999,
          status: 'Open',
        });
        await ord1.insert();
      });

      // In tenant_2 context: verify tenant_1 order cannot be fetched by custom controller logic
      await siteContext.run({ site: 'default', tenantId: 'tenant_2' }, async () => {
        // Direct getList from custom controller helper
        const list = await docService.getList('CustomOrder');
        expect(list.some((o) => o.name === 'ORD-T1-01')).toBe(false);

        // Attempting to access CUST-T1 or ORD-T1-01 throws NotFoundException
        await expect(docService.getDoc('CustomOrder', 'ORD-T1-01')).rejects.toThrow(/not found/);
      });
    });
  });
});
