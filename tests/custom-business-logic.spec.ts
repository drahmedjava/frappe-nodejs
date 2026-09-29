import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, Injectable } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DocumentService } from '../src/document/document.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { OnDocEvent } from '../src/document/decorators/on-doc-event.decorator';
import { DocumentEventPayload } from '../src/document/types';
import { DocType } from '../src/meta/types';

// -------------------------------------------------------------
// Test Listener using @OnDocEvent decorator
// -------------------------------------------------------------
@Injectable()
export class BusinessLogicAuditListener {
  public savedOrders: string[] = [];
  public deletedDocs: Array<{ doctype: string; name: string }> = [];

  @OnDocEvent('BLOrder', 'after_save')
  handleOrderSaved(payload: DocumentEventPayload) {
    this.savedOrders.push(payload.name);
  }

  @OnDocEvent('*', 'before_delete')
  handleAnyDocDelete(payload: DocumentEventPayload) {
    this.deletedDocs.push({ doctype: payload.doctype, name: payload.name });
  }
}

describe('Phase: Custom Business Logic (Server Scripts, Client Scripts & Event Hooks)', () => {
  let app: INestApplication;
  let docService: DocumentService;
  let registry: DocTypeRegistryService;
  let schemaSync: SchemaSyncService;
  let auditListener: BusinessLogicAuditListener;

  const blCustomerMeta: DocType = {
    name: 'BLCustomer',
    namingRule: 'field',
    autoname: 'customer_code',
    fields: [
      { fieldname: 'customer_code', label: 'Code', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'customer_name', label: 'Name', fieldtype: 'Data', reqd: true },
      { fieldname: 'is_active', label: 'Active', fieldtype: 'Check', default: 1 },
    ],
    permissions: [{ role: 'All', read: true, write: true, create: true, delete: true }],
  };

  const blOrderMeta: DocType = {
    name: 'BLOrder',
    namingRule: 'field',
    autoname: 'order_id',
    fields: [
      { fieldname: 'order_id', label: 'Order ID', fieldtype: 'Data', reqd: true, unique: true },
      { fieldname: 'customer', label: 'Customer', fieldtype: 'Link', options: 'BLCustomer', reqd: true },
      { fieldname: 'total_amount', label: 'Total Amount', fieldtype: 'Currency', default: 0 },
      { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: ['Draft', 'Confirmed'], default: 'Draft' },
    ],
    permissions: [{ role: 'All', read: true, write: true, create: true, delete: true }],
  };

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      providers: [BusinessLogicAuditListener],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    docService = moduleRef.get<DocumentService>(DocumentService);
    registry = moduleRef.get<DocTypeRegistryService>(DocTypeRegistryService);
    schemaSync = moduleRef.get<SchemaSyncService>(SchemaSyncService);
    auditListener = moduleRef.get<BusinessLogicAuditListener>(BusinessLogicAuditListener);

    // Register DocTypes
    registry.register(blCustomerMeta);
    registry.register(blOrderMeta);

    // Sync schema (includes built-in ServerScript, ClientScript, etc.)
    await schemaSync.syncAll();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Server Script API Execution (script_type: API)', () => {
    beforeAll(async () => {
      // 1. Create a customer
      const cust = docService.newDoc('BLCustomer', {
        customer_code: 'CUST-BL-01',
        customer_name: 'Stark Industries',
        is_active: 1,
      });
      await cust.insert();

      // 2. Create orders for customer
      const ord1 = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-01',
        customer: 'CUST-BL-01',
        total_amount: 1500,
        status: 'Draft',
      });
      await ord1.insert();

      const ord2 = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-02',
        customer: 'CUST-BL-01',
        total_amount: 2500,
        status: 'Confirmed',
      });
      await ord2.insert();

      // 3. Create a Server Script API endpoint
      const script = docService.newDoc('ServerScript', {
        title: 'Customer Orders Summary API',
        script_type: 'API',
        api_method: 'bl.get_customer_metrics',
        script: `
          const code = frappe.form_dict.customer_code;
          const customer = await frappe.get_doc('BLCustomer', code);
          const orders = await frappe.db.get_list('BLOrder', {
            filters: { customer: code }
          });
          const totalSpent = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
          frappe.response.message = {
            customer: customer.customer_name,
            totalOrders: orders.length,
            totalSpent: totalSpent
          };
        `,
      });
      await script.insert();
    });

    it('should execute Server Script API via POST /api/method/:api_method', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/bl.get_customer_metrics')
        .set('x-frappe-user', 'Administrator')
        .send({ customer_code: 'CUST-BL-01' })
        .expect(201);

      expect(res.body.message).toBeDefined();
      expect(res.body.message.customer).toBe('Stark Industries');
      expect(res.body.message.totalOrders).toBe(2);
      expect(res.body.message.totalSpent).toBe(4000);
    });

    it('should execute Server Script API via GET /api/method/:api_method with query params', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/method/bl.get_customer_metrics?customer_code=CUST-BL-01')
        .set('x-frappe-user', 'Administrator')
        .expect(200);

      expect(res.body.message.customer).toBe('Stark Industries');
      expect(res.body.message.totalSpent).toBe(4000);
    });
  });

  describe('2. Enriched Server Script VM Sandbox (frappe.db & frappe.get_doc)', () => {
    it('should enforce business rule using frappe.throw in DocType validate event', async () => {
      // Create a validate script restricting order amounts
      const ruleScript = docService.newDoc('ServerScript', {
        title: 'Order Limit Guard',
        script_type: 'DocType Event',
        reference_doctype: 'BLOrder',
        doctype_event: 'validate',
        script: `
          if (doc.total_amount > 5000) {
            frappe.throw("Orders exceeding 5000 require manager approval");
          }
        `,
      });
      await ruleScript.insert();

      // Attempt creating order > 5000
      const largeOrder = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-OVERLIMIT',
        customer: 'CUST-BL-01',
        total_amount: 9999,
      });

      await expect(largeOrder.insert()).rejects.toThrow(
        /Orders exceeding 5000 require manager approval/,
      );

      // Order <= 5000 succeeds
      const validOrder = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-VALID',
        customer: 'CUST-BL-01',
        total_amount: 4500,
      });
      await validOrder.insert();
      expect(validOrder.name).toBe('BL-ORD-VALID');
    });

    it('should mutate related records using frappe.db.set_value in after_save event', async () => {
      const autoConfirmScript = docService.newDoc('ServerScript', {
        title: 'Auto Update Customer',
        script_type: 'DocType Event',
        reference_doctype: 'BLOrder',
        doctype_event: 'after_save',
        script: `
          if (doc.order_id === 'BL-ORD-MUTATE') {
            await frappe.db.set_value('BLCustomer', doc.customer, 'customer_name', 'Wayne Enterprises');
          }
        `,
      });
      await autoConfirmScript.insert();

      const order = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-MUTATE',
        customer: 'CUST-BL-01',
        total_amount: 1000,
      });
      await order.insert();

      // Check that customer_name was updated by the script
      const cust = await docService.getDoc('BLCustomer', 'CUST-BL-01');
      expect(cust.get('customer_name')).toBe('Wayne Enterprises');
    });
  });

  describe('3. Client Scripts (ClientScript DocType & Delivery)', () => {
    it('should create and retrieve client-side scripts via frappe.client.get_client_scripts', async () => {
      // 1. Create client script
      const cs = docService.newDoc('ClientScript', {
        dt: 'BLOrder',
        view: 'Form',
        script: `
          frappe.ui.form.on('BLOrder', {
            refresh(frm) {
              if (frm.doc.status === 'Draft') {
                frm.add_custom_button('Confirm Order', () => frm.call('confirm'));
              }
            }
          });
        `,
        enabled: 1,
      });
      await cs.insert();

      // 2. Fetch scripts via RPC
      const res = await request(app.getHttpServer())
        .get('/api/method/frappe.client.get_client_scripts?dt=BLOrder')
        .expect(200);

      expect(res.body.message.scripts).toBeDefined();
      expect(res.body.message.scripts.length).toBeGreaterThanOrEqual(1);
      expect(res.body.message.scripts[0].dt).toBe('BLOrder');
      expect(res.body.message.scripts[0].script).toContain("add_custom_button('Confirm Order'");
    });
  });

  describe('4. @OnDocEvent() Decorator Lifecycle Hooks', () => {
    it('should invoke listener method decorated with @OnDocEvent', async () => {
      // Create new BLOrder
      const order = docService.newDoc('BLOrder', {
        order_id: 'BL-ORD-HOOK-01',
        customer: 'CUST-BL-01',
        total_amount: 300,
      });
      await order.insert();

      // Verify specific listener captured after_save
      expect(auditListener.savedOrders).toContain('BL-ORD-HOOK-01');

      // Delete order
      await order.delete();

      // Verify wildcard listener captured before_delete
      expect(
        auditListener.deletedDocs.some(
          (d) => d.doctype === 'BLOrder' && d.name === 'BL-ORD-HOOK-01',
        ),
      ).toBe(true);
    });
  });
});
