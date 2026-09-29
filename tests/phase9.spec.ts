import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SchemaSyncService } from '../src/meta/schema-sync.service';
import { DocTypeRegistryService } from '../src/meta/doctype-registry.service';
import { DocumentService } from '../src/document/document.service';
import { PrintFormatService } from '../src/peripheral/print-format.service';
import { DataImportExportService } from '../src/peripheral/data-import-export.service';
import { DocType } from '../src/meta/types';

describe('Phase 9 Peripheral Features (Print Formats & Data Import/Export)', () => {
  let app: INestApplication;
  let syncService: SchemaSyncService;
  let registry: DocTypeRegistryService;
  let docService: DocumentService;
  let printService: PrintFormatService;
  let importExportService: DataImportExportService;

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
    printService = moduleRef.get<PrintFormatService>(PrintFormatService);
    importExportService = moduleRef.get<DataImportExportService>(DataImportExportService);

    // Register test Invoice doctype with InvoiceItem child table
    const invoiceItemDocType: DocType = {
      name: 'InvoiceItem',
      isChildTable: true,
      fields: [
        { fieldname: 'item_name', label: 'Item Name', fieldtype: 'Data', reqd: true },
        { fieldname: 'qty', label: 'Qty', fieldtype: 'Int', default: 1 },
        { fieldname: 'rate', label: 'Rate', fieldtype: 'Currency', default: 0 },
      ],
    };

    const invoiceDocType: DocType = {
      name: 'Invoice',
      isSubmittable: true,
      namingRule: 'series',
      autoname: 'INV-.#####',
      fields: [
        { fieldname: 'customer', label: 'Customer', fieldtype: 'Data', reqd: true },
        { fieldname: 'status', label: 'Status', fieldtype: 'Select', options: ['Draft', 'Unpaid', 'Paid'], default: 'Draft' },
        { fieldname: 'total_amount', label: 'Total Amount', fieldtype: 'Currency', default: 0 },
        { fieldname: 'items', label: 'Items', fieldtype: 'Table', options: 'InvoiceItem' },
      ],
      permissions: [
        { role: 'System Manager', read: true, write: true, create: true, submit: true, cancel: true, amend: true },
        { role: 'All', read: true, write: true, create: true },
      ],
    };

    registry.register(invoiceItemDocType);
    registry.register(invoiceDocType);

    await syncService.syncAll();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Print Format Engine', () => {
    let invoiceName: string;

    beforeAll(async () => {
      const inv = docService.newDoc('Invoice', {
        customer: 'Stark Industries',
        status: 'Unpaid',
        total_amount: 5400,
        items: [
          { item_name: 'Arc Reactor Core', qty: 2, rate: 2500 },
          { item_name: 'Vibranium Solder', qty: 4, rate: 100 },
        ],
      });
      await inv.insert();
      await inv.submit();
      invoiceName = inv.name;
    });

    it('should render standard print format with doc info and child tables', async () => {
      const doc = await docService.getDoc('Invoice', invoiceName);
      const html = await printService.render(doc);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Invoice: ' + invoiceName);
      expect(html).toContain('Stark Industries');
      expect(html).toContain('5400');
      expect(html).toContain('Submitted');
      expect(html).toContain('Arc Reactor Core');
      expect(html).toContain('Vibranium Solder');
    });

    it('should render custom print format with handlebars-style variables & loops', async () => {
      // Create custom PrintFormat record
      const pf = docService.newDoc('PrintFormat', {
        name_format: 'Custom Stark Invoice',
        doc_type: 'Invoice',
        standard: false,
        html: `
          <div class="custom-inv">
            <h1>BILL TO: {{ doc.customer }}</h1>
            <p>Invoice #: {{ doc.name }}</p>
            <p>Total: $ {{ doc.total_amount }}</p>
            <div class="items">
              {{#each items}}
                <div class="item-line">{{ this.item_name }} (x{{ this.qty }})</div>
              {{/each}}
            </div>
          </div>
        `,
        css: '.custom-inv { font-family: monospace; color: #1e3a8a; }',
      });
      await pf.insert();

      const doc = await docService.getDoc('Invoice', invoiceName);
      const customHtml = await printService.render(doc, 'Custom Stark Invoice');

      expect(customHtml).toContain('BILL TO: Stark Industries');
      expect(customHtml).toContain(`Invoice #: ${invoiceName}`);
      expect(customHtml).toContain('Total: $ 5400');
      expect(customHtml).toContain('Arc Reactor Core (x2)');
      expect(customHtml).toContain('Vibranium Solder (x4)');
      expect(customHtml).toContain('.custom-inv { font-family: monospace;');
    });

    it('GET /api/resource/:doctype/:name/print - should serve HTML print preview over HTTP', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/resource/Invoice/${invoiceName}/print`)
        .set('x-frappe-user', 'Administrator')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain(`Invoice: ${invoiceName}`);
      expect(res.text).toContain('Stark Industries');
    });

    it('POST /api/method/frappe.client.get_print_html - should return print HTML via RPC', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/method/frappe.client.get_print_html')
        .set('x-frappe-user', 'Administrator')
        .send({ doctype: 'Invoice', name: invoiceName })
        .expect(201);

      expect(res.body.message).toContain(`Invoice: ${invoiceName}`);
    });
  });

  describe('Data Export Tool', () => {
    it('should export documents to JSON format', async () => {
      const result = await importExportService.exportData('Invoice', 'json');
      expect(result.mimeType).toBe('application/json');
      expect(result.filename).toMatch(/^Invoice_export_.*\.json$/);

      const parsed = JSON.parse(result.data);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed[0].customer).toBe('Stark Industries');
      expect(parsed[0].items).toHaveLength(2);
    });

    it('should export documents to RFC 4180 CSV format', async () => {
      const result = await importExportService.exportData('Invoice', 'csv');
      expect(result.mimeType).toBe('text/csv');
      expect(result.filename).toMatch(/^Invoice_export_.*\.csv$/);

      const lines = result.data.split('\n');
      expect(lines.length).toBeGreaterThanOrEqual(2); // Header + at least 1 record
      expect(lines[0]).toContain('name');
      expect(lines[0]).toContain('customer');
      expect(lines[0]).toContain('total_amount');
      expect(result.data).toContain('Stark Industries');
    });

    it('GET /api/resource/:doctype/export - should export CSV file over HTTP', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/resource/Invoice/export?format=csv')
        .set('x-frappe-user', 'Administrator')
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.text).toContain('customer');
      expect(res.text).toContain('Stark Industries');
    });
  });

  describe('Data Import Tool', () => {
    it('should import documents from JSON array', async () => {
      const jsonRecords = [
        { customer: 'Wayne Enterprises', status: 'Draft', total_amount: 12000 },
        { customer: 'Oscorp Industries', status: 'Unpaid', total_amount: 8500 },
      ];

      const res = await importExportService.importData('Invoice', jsonRecords, 'json');
      expect(res.total).toBe(2);
      expect(res.success).toBe(2);
      expect(res.failed).toBe(0);

      const wayneDoc = await docService.getList('Invoice', { filters: { customer: 'Wayne Enterprises' } });
      expect(wayneDoc).toHaveLength(1);
      expect(wayneDoc[0].total_amount).toBe(12000);
    });

    it('should import documents from CSV text including quoted and comma fields', async () => {
      const csvData = [
        'customer,status,total_amount',
        '"Queen Industries, Star City",Unpaid,4500',
        '"Pym Technologies, Inc.",Draft,9900',
      ].join('\n');

      const res = await importExportService.importData('Invoice', csvData, 'csv');
      expect(res.total).toBe(2);
      expect(res.success).toBe(2);
      expect(res.failed).toBe(0);

      const queen = await docService.getList('Invoice', { filters: { customer: 'Queen Industries, Star City' } });
      expect(queen).toHaveLength(1);
      expect(queen[0].total_amount).toBe(4500);
    });

    it('should upsert existing documents when document name is provided in CSV', async () => {
      // Create initial doc
      const initial = docService.newDoc('Invoice', { customer: 'Cyberdyne Systems', total_amount: 1000 });
      await initial.insert();
      const existingName = initial.name;

      // Import with existing name to update
      const updateCsv = [
        'name,customer,total_amount',
        `${existingName},Cyberdyne Systems,25000`,
      ].join('\n');

      const res = await importExportService.importData('Invoice', updateCsv, 'csv');
      expect(res.success).toBe(1);

      const updated = await docService.getDoc('Invoice', existingName);
      expect(updated.total_amount).toBe(25000);
    });

    it('should capture row validation errors without halting remaining rows', async () => {
      const mixedCsv = [
        'customer,total_amount',
        'Valid Company A,500',
        ',invalid_missing_customer_reqd', // missing reqd customer
        'Valid Company B,700',
      ].join('\n');

      const res = await importExportService.importData('Invoice', mixedCsv, 'csv');
      expect(res.total).toBe(3);
      expect(res.success).toBe(2);
      expect(res.failed).toBe(1);
      expect(res.errors).toHaveLength(1);
      expect(res.errors[0].row).toBe(2);
      expect(res.errors[0].message).toMatch(/Validation failed/);
    });

    it('POST /api/resource/:doctype/import - should import records over HTTP', async () => {
      const httpRecords = [
        { customer: 'Umbrella Corporation', total_amount: 66600 },
      ];

      const res = await request(app.getHttpServer())
        .post('/api/resource/Invoice/import?format=json')
        .set('x-frappe-user', 'Administrator')
        .send(httpRecords)
        .expect(201);

      expect(res.body.data.success).toBe(1);
      expect(res.body.data.failed).toBe(0);

      const umbrella = await docService.getList('Invoice', { filters: { customer: 'Umbrella Corporation' } });
      expect(umbrella).toHaveLength(1);
    });
  });
});
