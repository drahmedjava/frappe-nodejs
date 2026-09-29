import { Module, OnModuleInit } from '@nestjs/common';
import { WebsiteService } from './website.service';
import { WebsiteController } from './website.controller';
import { DocumentModule } from '../document/document.module';
import { DatabaseModule } from '../database/database.module';
import { MethodRegistryService } from '../api/method-registry.service';
import { ApiModule } from '../api/api.module';

@Module({
  imports: [DocumentModule, DatabaseModule, ApiModule],
  controllers: [WebsiteController],
  providers: [WebsiteService],
  exports: [WebsiteService],
})
export class WebsiteModule implements OnModuleInit {
  constructor(
    private readonly websiteService: WebsiteService,
    private readonly methodRegistry: MethodRegistryService,
  ) {}

  onModuleInit() {
    this.methodRegistry.register(
      'frappe.website.get_settings',
      async () => this.websiteService.getSettings(),
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.website.get_page',
      async (params) => this.websiteService.getWebPage(params.route),
      { isPublic: true },
    );

    this.methodRegistry.register(
      'frappe.website.render_template',
      async (params) => this.websiteService.renderTemplate(params.template || '', params.context || {}),
      { isPublic: true },
    );
  }
}
