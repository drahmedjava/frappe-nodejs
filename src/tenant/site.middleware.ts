import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { SiteResolverService } from './site-resolver.service';
import { SiteContextService } from './site-context.service';

@Injectable()
export class SiteMiddleware implements NestMiddleware {
  constructor(
    private readonly siteResolver: SiteResolverService,
    private readonly siteContext: SiteContextService,
  ) {}

  use(req: Request, res: Response, next: NextFunction) {
    const siteName = this.siteResolver.resolveSite(req.headers, req.query);
    const tenantId = this.siteResolver.resolveTenantId(req.headers, req.query);
    const context = this.siteResolver.resolveSiteContext(siteName, tenantId);

    // Set site and tenant tracking headers and request properties
    res.setHeader('X-Frappe-Site-Name', siteName);
    if (tenantId) {
      res.setHeader('X-Frappe-Tenant-Id', tenantId);
    }

    (req as any).site = siteName;
    (req as any).tenantId = tenantId;
    (req as any).siteContext = context;

    // Run the rest of the HTTP request lifecycle inside the tenant's AsyncLocalStorage context
    this.siteContext.run(context, () => {
      next();
    });
  }
}
