import { Global, Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { MetaModule } from '../meta/meta.module';
import { DocumentModule } from '../document/document.module';
import { SiteContextService } from './site-context.service';
import { TenantConnectionPool } from './tenant-connection-pool.service';
import { SiteResolverService } from './site-resolver.service';
import { SiteStorageService } from './site-storage.service';
import { SiteManagerService } from './site-manager.service';
import { SiteMiddleware } from './site.middleware';

@Global()
@Module({
  imports: [MetaModule, DocumentModule],
  providers: [
    SiteContextService,
    TenantConnectionPool,
    SiteResolverService,
    SiteStorageService,
    SiteManagerService,
    SiteMiddleware,
  ],
  exports: [
    SiteContextService,
    TenantConnectionPool,
    SiteResolverService,
    SiteStorageService,
    SiteManagerService,
    SiteMiddleware,
  ],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply SiteMiddleware to all incoming routes
    consumer.apply(SiteMiddleware).forRoutes('*');
  }
}
