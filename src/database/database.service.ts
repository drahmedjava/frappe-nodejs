import { Injectable, OnApplicationShutdown, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import knex, { Knex } from 'knex';
import * as fs from 'fs';
import * as path from 'path';
import { SiteContextService } from '../tenant/site-context.service';

export const KNEX_CONNECTION = Symbol('KNEX_CONNECTION');

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseService.name);
  private knexInstance: Knex;

  constructor(
    private configService: ConfigService,
    @Optional() private readonly siteContext?: SiteContextService,
  ) {
    const dbConfig = this.configService.get('database');
    const client = dbConfig?.client || 'sqlite3';

    let connection: any;

    if (client === 'sqlite3') {
      const filename = dbConfig?.filename || ':memory:';
      if (filename !== ':memory:') {
        const dir = path.dirname(path.resolve(filename));
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }
      connection = { filename };
    } else {
      connection = {
        host: dbConfig?.host,
        port: dbConfig?.port,
        user: dbConfig?.user,
        password: dbConfig?.password,
        database: dbConfig?.database,
      };
    }

    this.knexInstance = knex({
      client,
      connection,
      useNullAsDefault: client === 'sqlite3',
      pool:
        client === 'sqlite3' && connection.filename === ':memory:'
          ? { min: 1, max: 1 }
          : { min: 1, max: 10 },
    });

    this.logger.log(`Initialized database connection using [${client}]`);
  }

  getKnex(): Knex {
    const tenantKnex = this.siteContext?.getCurrentKnex();
    if (tenantKnex) {
      return tenantKnex;
    }
    return this.knexInstance;
  }

  table(tableName: string): Knex.QueryBuilder {
    return this.getKnex()(tableName);
  }

  async sql<T = any>(query: string, bindings?: any[]): Promise<T[]> {
    const result = await this.getKnex().raw(query, bindings || []);
    // Normalize return across drivers: SQLite/Postgres vs MySQL
    if (Array.isArray(result)) {
      return result;
    }
    if (result && Array.isArray(result.rows)) {
      return result.rows;
    }
    return result;
  }

  async hasTable(tableName: string): Promise<boolean> {
    return this.getKnex().schema.hasTable(tableName);
  }

  async transaction<T>(callback: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.getKnex().transaction(callback);
  }

  async ping(): Promise<boolean> {
    try {
      await this.getKnex().raw('SELECT 1');
      return true;
    } catch (err) {
      this.logger.error('Database ping failed:', err);
      return false;
    }
  }

  async onApplicationShutdown() {
    this.logger.log('Closing database connection pool...');
    await this.knexInstance.destroy();
  }
}
