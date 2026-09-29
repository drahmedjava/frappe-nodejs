import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { SiteResolverService } from './site-resolver.service';
import { TenantConnectionPool } from './tenant-connection-pool.service';
import { SiteContextService } from './site-context.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { DocumentService } from '../document/document.service';
import { CreateSiteOptions, SiteConfig, SiteContext } from './types';

@Injectable()
export class SiteManagerService {
  private readonly logger = new Logger(SiteManagerService.name);

  constructor(
    private readonly siteResolver: SiteResolverService,
    private readonly connectionPool: TenantConnectionPool,
    private readonly siteContext: SiteContextService,
    private readonly syncService: SchemaSyncService,
    private readonly docService: DocumentService,
  ) {}

  /**
   * Scans and returns list of all configured sites in the sites directory.
   */
  listSites(): string[] {
    const sitesPath = this.siteResolver.getSitesPath();
    if (!fs.existsSync(sitesPath)) {
      return [];
    }

    const entries = fs.readdirSync(sitesPath, { withFileTypes: true });
    const sites: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const configPath = path.join(sitesPath, entry.name, 'site_config.json');
        if (fs.existsSync(configPath)) {
          sites.push(entry.name);
        }
      }
    }

    return sites;
  }

  /**
   * Creates a brand new site with its own database, directory structure, and schema.
   */
  async createSite(options: CreateSiteOptions): Promise<SiteContext> {
    const sitename = options.sitename.trim();
    if (!sitename) {
      throw new Error('Sitename cannot be empty');
    }

    const siteDir = this.siteResolver.getSitePath(sitename);

    if (this.siteResolver.siteExists(sitename) && !options.force) {
      throw new ConflictException(`Site "${sitename}" already exists`);
    }

    // 1. Create directories
    const publicFiles = path.join(siteDir, 'public', 'files');
    const privateFiles = path.join(siteDir, 'private', 'files');
    fs.mkdirSync(publicFiles, { recursive: true });
    fs.mkdirSync(privateFiles, { recursive: true });

    // 2. Generate site_config.json
    const dbType = options.dbType || (options.dbHost ? 'mysql2' : 'sqlite3');
    const dbName =
      options.dbName ||
      (dbType === 'sqlite3'
        ? path.join(siteDir, 'site.db')
        : `frappe_${sitename.replace(/[^a-zA-Z0-9_]/g, '_')}`);

    const siteConfig: SiteConfig = {
      db_type: dbType,
      db_name: dbName,
      db_host: options.dbHost,
      db_port: options.dbPort,
      db_user: options.dbUser,
      db_password: options.dbPassword,
      encryption_key: crypto.randomBytes(16).toString('hex'),
      developer_mode: true,
    };

    const configPath = path.join(siteDir, 'site_config.json');
    fs.writeFileSync(configPath, JSON.stringify(siteConfig, null, 2), 'utf-8');
    this.logger.log(`Created site config at [${configPath}]`);

    // 3. Obtain Knex pool
    const knex = this.connectionPool.getOrCreatePool(sitename, siteConfig, siteDir);
    const context: SiteContext = {
      site: sitename,
      siteDir,
      config: siteConfig,
      knex,
    };

    // 4. Initialize schema and seed core data inside site context
    await this.siteContext.run(context, async () => {
      this.logger.log(`Running initial schema migration for site [${sitename}]...`);
      await this.syncService.syncAll();

      // Seed default Administrator user if tabUser exists
      try {
        const hasUserTable = await knex.schema.hasTable('tabUser');
        if (hasUserTable) {
          const adminExists = await knex('tabUser').where({ email: 'Administrator' }).orWhere({ name: 'Administrator' }).first();
          if (!adminExists) {
            const adminDoc = this.docService.newDoc('User', {
              email: 'Administrator',
              first_name: 'Administrator',
              enabled: 1,
              roles: [{ role: 'System Manager' }, { role: 'All' }],
            });
            await adminDoc.insert('Administrator');
            this.logger.log(`Seeded default Administrator for site [${sitename}]`);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Could not seed Administrator for site [${sitename}]: ${err.message}`);
      }
    });

    return context;
  }

  /**
   * Migrates DocType schema on a specific site.
   */
  async migrateSite(sitename: string): Promise<string> {
    if (!this.siteResolver.siteExists(sitename)) {
      throw new NotFoundException(`Site "${sitename}" does not exist`);
    }

    const context = this.siteResolver.resolveSiteContext(sitename);

    await this.siteContext.run(context, async () => {
      this.logger.log(`Migrating site [${sitename}]...`);
      await this.syncService.syncAll();
    });

    return `Site "${sitename}" migrated successfully`;
  }

  /**
   * Drops a site, destroys its connection pool, and deletes its directory.
   */
  async dropSite(sitename: string): Promise<void> {
    if (!this.siteResolver.siteExists(sitename)) {
      throw new NotFoundException(`Site "${sitename}" not found`);
    }

    // 1. Destroy DB connection pool
    await this.connectionPool.closePool(sitename);

    // 2. Remove site folder
    const siteDir = this.siteResolver.getSitePath(sitename);
    if (fs.existsSync(siteDir)) {
      fs.rmSync(siteDir, { recursive: true, force: true });
    }

    this.logger.log(`Dropped site [${sitename}]`);
  }
}
