import { Module, OnModuleInit, NotFoundException, Optional } from '@nestjs/common';
import { DiscoveryModule, DiscoveryService } from '@nestjs/core';
import { ResourceController } from './resource.controller';
import { MethodController } from './method.controller';
import { MethodRegistryService } from './method-registry.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { DocumentService } from '../document/document.service';
import { DocumentEventsService } from '../document/document-events.service';
import { PeripheralModule } from '../peripheral/peripheral.module';
import { PrintFormatService } from '../peripheral/print-format.service';
import { DataImportExportService } from '../peripheral/data-import-export.service';
import { SiteManagerService } from '../tenant/site-manager.service';
import { SiteContextService } from '../tenant/site-context.service';
import { ViewService } from './view.service';
import { DeskModule } from '../desk/desk.module';
import { WorkspaceService } from '../desk/workspace.service';

@Module({
  imports: [PeripheralModule, DiscoveryModule, DeskModule],
  controllers: [ResourceController, MethodController],
  providers: [MethodRegistryService, ViewService],
  exports: [MethodRegistryService, ViewService],
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
    private readonly discoveryService: DiscoveryService,
    private readonly docEvents: DocumentEventsService,
    private readonly viewService: ViewService,
    @Optional() private readonly workspaceService?: WorkspaceService,
  ) {}


  onModuleInit() {
    // 1. Auto-discover all @Whitelist() and @OnDocEvent() decorated methods across providers & controllers
    try {
      const controllers = this.discoveryService.getControllers();
      const providers = this.discoveryService.getProviders();
      for (const wrapper of [...controllers, ...providers]) {
        if (wrapper.instance) {
          this.methodRegistry.registerInstance(wrapper.instance);
          this.docEvents.registerInstance(wrapper.instance);
        }
      }
    } catch {
      // Ignore discovery errors in partial testing setups
    }

    // 2. Register Frappe RPC run_doc_method
    this.methodRegistry.register(
      'run_doc_method',
      async (params, ctx) => {
        const dt = params.dt || params.doctype;
        const dn = params.dn || params.docname || params.name;
        const method = params.method;
        const args = params.args || params.data || {};

        if (!dt || !dn || !method) {
          throw new Error('dt (DocType), dn (name), and method parameters are required');
        }

        const doc = await this.docService.getDoc(dt, dn);
        if (typeof (doc as any)[method] !== 'function') {
          throw new NotFoundException(`Method "${method}" not found on document ${dt} "${dn}"`);
        }

        return (doc as any)[method](args, ctx);
      },
      { isPublic: false },
    );

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
      'frappe.client.get_client_scripts',
      async (params) => {
        const dt = params.dt || params.doctype;
        if (!dt) throw new Error('dt (DocType) parameter is required');
        const view = params.view || 'Form';
        const hasTable = await this.docService['db'].hasTable('tabClientScript');
        if (!hasTable) return { scripts: [] };

        const rows = await this.docService['db']
          .table('tabClientScript')
          .where({ dt, enabled: 1 })
          .andWhere((q: any) => {
            q.where({ view }).orWhereNull('view');
          });

        return {
          scripts: rows.map((r: any) => ({
            name: r.name,
            dt: r.dt,
            view: r.view,
            script: r.script,
          })),
        };
      },
      { isPublic: true },
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

    // Multi-View Support Methods
    this.methodRegistry.register(
      'frappe.views.get_views',
      async (params) => {
        if (!params.doctype) throw new Error('doctype parameter is required');
        return this.viewService.getViews(params.doctype);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.views.create_kanban_board',
      async (params) => this.viewService.createKanbanBoard(params),
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.views.get_kanban_board_data',
      async (params) => {
        if (!params.board_name) throw new Error('board_name parameter is required');
        return this.viewService.getKanbanBoardData(params.board_name, params.filters);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.views.update_card_column',
      async (params) => {
        if (!params.doctype || !params.name || !params.field_name) {
          throw new Error('doctype, name, and field_name parameters are required');
        }
        return this.viewService.updateCardColumn(params.doctype, params.name, params.field_name, params.new_value);
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.views.create_custom_view',
      async (params) => this.viewService.createCustomView(params),
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.views.get_calendar_data',
      async (params) => {
        if (!params.doctype) throw new Error('doctype parameter is required');
        return this.viewService.getCalendarData(params.doctype, params);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.views.get_custom_html_blocks',
      async (params) => this.viewService.getCustomHtmlBlocks(params.doctype),
      { isPublic: true },
    );

    // Workspace & Sidebar Navigation Methods
    this.methodRegistry.register(
      'frappe.desk.desktop.get_workspace_sidebar_items',
      async (_params, ctx) => {
        if (!this.workspaceService) return { my_workspaces: [], public_workspaces: [], all: [] };
        return this.workspaceService.getSidebarItems(ctx.user);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'desk.get_workspace_sidebar_items',
      async (_params, ctx) => {
        if (!this.workspaceService) return { my_workspaces: [], public_workspaces: [], all: [] };
        return this.workspaceService.getSidebarItems(ctx.user);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.desk.desktop.get_workspace',
      async (params, ctx) => {
        if (!this.workspaceService) return null;
        const name = params.name || params.title;
        if (!name) throw new Error('name or title is required');
        return this.workspaceService.getWorkspace(name, ctx.user);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'desk.get_workspace',
      async (params, ctx) => {
        if (!this.workspaceService) return null;
        const name = params.name || params.title;
        if (!name) throw new Error('name or title is required');
        return this.workspaceService.getWorkspace(name, ctx.user);
      },
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.desk.desktop.save_workspace',
      async (params, ctx) => {
        if (!this.workspaceService) return null;
        return this.workspaceService.saveWorkspace(params, ctx.user);
      },
      { isPublic: false },
    );

    this.methodRegistry.register(
      'frappe.desk.desktop.delete_workspace',
      async (params, ctx) => {
        if (!this.workspaceService) return false;
        const name = params.name || params.title;
        if (!name) throw new Error('name or title is required');
        return this.workspaceService.deleteWorkspace(name, ctx.user);
      },
      { isPublic: false },
    );
  }
}

