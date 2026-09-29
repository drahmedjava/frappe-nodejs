import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Knex } from 'knex';
import { SiteContext } from './types';

@Injectable()
export class SiteContextService {
  private readonly logger = new Logger(SiteContextService.name);
  private readonly storage = new AsyncLocalStorage<SiteContext>();

  /**
   * Runs an asynchronous callback within the context of a specific site.
   */
  run<R>(context: SiteContext, callback: () => R): R {
    return this.storage.run(context, callback);
  }

  /**
   * Alias for run(context, callback)
   */
  runWithSite<R>(context: SiteContext, callback: () => R): R {
    return this.storage.run(context, callback);
  }

  /**
   * Returns current active site context, or undefined if executing outside site context.
   */
  getCurrentContext(): SiteContext | undefined {
    return this.storage.getStore();
  }

  /**
   * Returns current active site name, or undefined.
   */
  getCurrentSite(): string | undefined {
    return this.storage.getStore()?.site;
  }

  /**
   * Returns current active site's Knex database instance, or undefined.
   */
  getCurrentKnex(): Knex | undefined {
    return this.storage.getStore()?.knex;
  }

  /**
   * Returns current active per-table tenant ID, or undefined.
   */
  getCurrentTenantId(): string | undefined {
    return this.storage.getStore()?.tenantId;
  }

  /**
   * Returns true if executing within a site context.
   */
  hasSiteContext(): boolean {
    return this.storage.getStore() !== undefined;
  }
}
