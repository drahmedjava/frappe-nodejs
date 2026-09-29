import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import knex, { Knex } from 'knex';
import * as path from 'path';
import * as fs from 'fs';
import { SiteConfig } from './types';

@Injectable()
export class TenantConnectionPool implements OnApplicationShutdown {
  private readonly logger = new Logger(TenantConnectionPool.name);
  private readonly pools = new Map<string, Knex>();

  /**
   * Returns an existing Knex connection pool for the site, or creates and caches a new one.
   */
  getOrCreatePool(site: string, config: SiteConfig, siteDir: string): Knex {
    const existing = this.pools.get(site);
    if (existing) {
      return existing;
    }

    const dbType = config.db_type || (config.db_host ? 'mysql2' : 'sqlite3');
    let instance: Knex;

    if (dbType === 'sqlite3') {
      const filename = config.db_name || path.join(siteDir, 'site.db');
      if (filename !== ':memory:') {
        const dir = path.dirname(path.resolve(filename));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      instance = knex({
        client: 'sqlite3',
        connection: { filename },
        useNullAsDefault: true,
        pool: filename === ':memory:' ? { min: 1, max: 1 } : { min: 1, max: 10 },
      });
      this.logger.log(`Initialized SQLite pool for site [${site}] at [${filename}]`);
    } else {
      instance = knex({
        client: dbType,
        connection: {
          host: config.db_host || '127.0.0.1',
          port: config.db_port || (dbType === 'pg' ? 5432 : 3306),
          user: config.db_user || 'root',
          password: config.db_password || '',
          database: config.db_name || `frappe_${site.replace(/[^a-zA-Z0-9_]/g, '_')}`,
        },
        pool: { min: 1, max: 10 },
      });
      this.logger.log(`Initialized ${dbType} pool for site [${site}] on [${config.db_host}]`);
    }

    this.pools.set(site, instance);
    return instance;
  }

  /**
   * Registers a pre-existing Knex instance for a site (e.g. for testing with in-memory DB).
   */
  setPool(site: string, knexInstance: Knex): void {
    this.pools.set(site, knexInstance);
  }

  /**
   * Checks if a pool already exists for the given site.
   */
  hasPool(site: string): boolean {
    return this.pools.has(site);
  }

  /**
   * Closes and removes the pool for a specific site.
   */
  async closePool(site: string): Promise<void> {
    const pool = this.pools.get(site);
    if (pool) {
      await pool.destroy();
      this.pools.delete(site);
      this.logger.log(`Destroyed database connection pool for site [${site}]`);
    }
  }

  /**
   * Closes all tenant pools on application shutdown.
   */
  async onApplicationShutdown(): Promise<void> {
    this.logger.log('Closing all tenant database connection pools...');
    const closePromises = Array.from(this.pools.values()).map((p) => p.destroy());
    await Promise.all(closePromises);
    this.pools.clear();
  }
}
