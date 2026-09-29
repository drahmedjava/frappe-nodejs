import { Knex } from 'knex';

export interface DatabaseConfig {
  client: 'sqlite3' | 'mysql2' | 'pg';
  filename?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface SiteConfig {
  db_name?: string;
  db_user?: string;
  db_password?: string;
  db_type?: 'sqlite3' | 'mysql2' | 'pg';
  db_host?: string;
  db_port?: number;
  encryption_key?: string;
  developer_mode?: boolean;
  [key: string]: any;
}

export interface SiteContext {
  site: string;
  tenantId?: string;
  siteDir: string;
  config: SiteConfig;
  knex?: Knex;
}

export interface CreateSiteOptions {
  sitename: string;
  adminPassword?: string;
  dbName?: string;
  dbType?: 'sqlite3' | 'mysql2' | 'pg';
  dbHost?: string;
  dbPort?: number;
  dbUser?: string;
  dbPassword?: string;
  force?: boolean;
}
