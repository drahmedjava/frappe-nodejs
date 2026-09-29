import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import { SiteConfig, SiteContext } from './types';
import { TenantConnectionPool } from './tenant-connection-pool.service';

@Injectable()
export class SiteResolverService {
  private readonly logger = new Logger(SiteResolverService.name);
  private sitesPath: string;

  constructor(private readonly connectionPool: TenantConnectionPool) {
    this.sitesPath = process.env.SITES_PATH
      ? path.resolve(process.env.SITES_PATH)
      : path.join(process.cwd(), 'sites');
  }

  setSitesPath(customPath: string): void {
    this.sitesPath = path.resolve(customPath);
  }

  getSitesPath(): string {
    return this.sitesPath;
  }

  getSitePath(site: string): string {
    return path.join(this.sitesPath, site);
  }

  siteExists(site: string): boolean {
    const siteDir = this.getSitePath(site);
    const configFile = path.join(siteDir, 'site_config.json');
    return fs.existsSync(configFile);
  }

  /**
   * Reads site configuration from site_config.json, merged with common_site_config.json if present.
   */
  getSiteConfig(site: string): SiteConfig {
    let commonConfig: Record<string, any> = {};
    const commonPath = path.join(this.sitesPath, 'common_site_config.json');
    if (fs.existsSync(commonPath)) {
      try {
        commonConfig = JSON.parse(fs.readFileSync(commonPath, 'utf-8'));
      } catch (e: any) {
        this.logger.warn(`Failed to parse common_site_config.json: ${e.message}`);
      }
    }

    const siteConfigPath = path.join(this.getSitePath(site), 'site_config.json');
    let siteConfig: Record<string, any> = {};
    if (fs.existsSync(siteConfigPath)) {
      try {
        siteConfig = JSON.parse(fs.readFileSync(siteConfigPath, 'utf-8'));
      } catch (e: any) {
        this.logger.warn(`Failed to parse site_config.json for site ${site}: ${e.message}`);
      }
    }

    return { ...commonConfig, ...siteConfig };
  }

  /**
   * Resolves site name from request headers, query string, host header, or defaults.
   */
  resolveSite(
    headers: Record<string, string | string[] | undefined> = {},
    query: Record<string, any> = {},
  ): string {
    // 1. Explicit X-Frappe-Site-Name header
    const headerVal = headers['x-frappe-site-name'] || headers['X-Frappe-Site-Name'];
    if (headerVal && typeof headerVal === 'string' && headerVal.trim()) {
      return headerVal.trim();
    }

    // 2. Query param: ?site=sitename
    if (query?.site && typeof query.site === 'string' && query.site.trim()) {
      return query.site.trim();
    }

    // 3. Host header matching (e.g. "site1.local:3000" -> "site1.local" or subdomain)
    const hostHeader = headers['host'];
    if (hostHeader && typeof hostHeader === 'string') {
      const hostname = hostHeader.split(':')[0].toLowerCase();

      // Direct match (e.g. folder sites/site1.local)
      if (this.siteExists(hostname)) {
        return hostname;
      }

      // Subdomain check (e.g. "site1.localhost" -> "site1")
      const parts = hostname.split('.');
      if (parts.length > 1 && this.siteExists(parts[0])) {
        return parts[0];
      }
    }

    // 4. Default site fallback
    const defaultSite = process.env.DEFAULT_SITE || 'default';
    return defaultSite;
  }

  /**
   * Resolves row-level tenant identifier from headers (e.g. X-Tenant-ID, X-Frappe-Tenant-Id) or query params.
   */
  resolveTenantId(
    headers: Record<string, string | string[] | undefined> = {},
    query: Record<string, any> = {},
  ): string | undefined {
    const headerVal =
      headers['x-tenant-id'] ||
      headers['X-Tenant-ID'] ||
      headers['x-frappe-tenant-id'] ||
      headers['X-Frappe-Tenant-Id'];

    if (headerVal && typeof headerVal === 'string' && headerVal.trim()) {
      return headerVal.trim();
    }

    const queryVal = query?.tenant_id || query?.tenantId;
    if (queryVal && typeof queryVal === 'string' && queryVal.trim()) {
      return queryVal.trim();
    }

    return undefined;
  }

  /**
   * Builds a full SiteContext (site name, tenant ID, directory, config, and active Knex connection pool if configured).
   */
  resolveSiteContext(siteName: string, tenantId?: string): SiteContext {
    const siteDir = this.getSitePath(siteName);
    const isConfigured = this.siteExists(siteName);
    const config = isConfigured ? this.getSiteConfig(siteName) : {};

    let knex: any = undefined;
    if (isConfigured) {
      knex = this.connectionPool.getOrCreatePool(siteName, config, siteDir);
    }

    return {
      site: siteName,
      tenantId,
      siteDir,
      config,
      knex,
    };
  }
}
