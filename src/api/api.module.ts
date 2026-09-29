import { Module, OnModuleInit } from '@nestjs/common';
import { ResourceController } from './resource.controller';
import { MethodController } from './method.controller';
import { MethodRegistryService } from './method-registry.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { DocumentService } from '../document/document.service';

@Module({
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
  }
}
