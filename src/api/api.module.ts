import { Module, OnModuleInit } from '@nestjs/common';
import { ResourceController } from './resource.controller';
import { MethodController } from './method.controller';
import { MethodRegistryService } from './method-registry.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { DocumentService } from '../document/document.service';
import { PeripheralModule } from '../peripheral/peripheral.module';
import { PrintFormatService } from '../peripheral/print-format.service';
import { DataImportExportService } from '../peripheral/data-import-export.service';
import { SiteManagerService } from '../tenant/site-manager.service';
import { SiteContextService } from '../tenant/site-context.service';

@Module({
  imports: [PeripheralModule],
  controllers: [ResourceController, MethodController],
  providers: [MethodRegistryService],
  exports: [MethodRegistryService],
})
export class ApiModule implements OnModuleInit {
  constructor(
    private readonly methodRegistry: MethodRegistryService,
    private readonly metaRegistry: DocTypeRegistryService,
    private readonly syncService: SchemaSyncService,
    private readonly docService: DocumentService,
    private readonly printService: PrintFormatService,
    private readonly importExportService: DataImportExportService,
    private readonly siteManager: SiteManagerService,
    private readonly siteContext: SiteContextService,
  ) {}

  onModuleInit() {
    // Register standard Frappe RPC methods
    this.methodRegistry.register('ping', () => 'pong', { isPublic: true });
    this.methodRegistry.register('frappe.ping', () => 'pong', { isPublic: true });

    this.methodRegistry.register(
      'frappe.get_meta',
      (params) => {
        if (!params.doctype) {
          throw new Error('doctype parameter is required');
        }
        return this.metaRegistry.get(params.doctype);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.auth.get_logged_user',
      (_params, ctx) => ctx.user.user,
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.client.get_list',
      async (params) => {
        if (!params.doctype) {
          throw new Error('doctype parameter is required');
        }
        return this.docService.getList(params.doctype, params);
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.get_doctypes',
      () => {
        return this.metaRegistry
          .getAll()
          .filter((d) => !d.isChildTable)
          .map((d) => ({ name: d.name, module: d.module, titleField: d.titleField }));
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.migrate',
      async () => {
        await this.syncService.syncAll();
        return 'Migration completed successfully';
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.client.export',
      async (params) => {
        if (!params.doctype) throw new Error('doctype parameter is required');
        return this.importExportService.exportData(params.doctype, params.format || 'json', params);
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.client.import',
      async (params, ctx) => {
        if (!params.doctype) throw new Error('doctype parameter is required');
        return this.importExportService.importData(
          params.doctype,
          params.data || params.csv,
          params.format || 'json',
          ctx.user.user,
        );
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.client.get_print_html',
      async (params) => {
        if (!params.doctype || !params.name) throw new Error('doctype and name are required');
        const doc = await this.docService.getDoc(params.doctype, params.name);
        return this.printService.render(doc, params.format);
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.tenant.get_current_site',
      () => this.siteContext.getCurrentSite() || 'default',
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.tenant.list_sites',
      () => this.siteManager.listSites(),
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.tenant.create_site',
      async (params) => {
        if (!params.sitename) throw new Error('sitename is required');
        const ctx = await this.siteManager.createSite({
          sitename: params.sitename,
          dbType: params.db_type,
          dbName: params.db_name,
          dbHost: params.db_host,
          dbPort: params.db_port,
          dbUser: params.db_user,
          dbPassword: params.db_password,
        });
        return { site: ctx.site, siteDir: ctx.siteDir };
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.tenant.migrate_site',
      async (params) => {
        if (!params.sitename) throw new Error('sitename is required');
        return this.siteManager.migrateSite(params.sitename);
      },
      { isPublic: false },
    );
  }
}
