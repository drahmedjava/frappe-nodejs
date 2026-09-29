import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocField, DocType } from './types';
import { DocTypeRegistryService } from './doctype-registry.service';
import { Knex } from 'knex';

@Injectable()
export class SchemaSyncService {
  private readonly logger = new Logger(SchemaSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: DocTypeRegistryService,
  ) {}

  getTableName(doctypeName: string): string {
    return `tab${doctypeName}`;
  }

  /**
   * Syncs a single DocType to the database (creates or alters table).
   */
  async syncDocType(docType: DocType): Promise<void> {
    if (docType.isSingle) {
      this.logger.log(`Skipping table creation for Single DocType [${docType.name}]`);
      return;
    }

    const tableName = this.getTableName(docType.name);
    const knex = this.db.getKnex();
    const tableExists = await knex.schema.hasTable(tableName);

    if (!tableExists) {
      await this.createTable(knex, docType, tableName);
      this.logger.log(`Created table [${tableName}] for DocType [${docType.name}]`);
    } else {
      await this.alterTable(knex, docType, tableName);
      this.logger.log(`Updated table [${tableName}] for DocType [${docType.name}]`);
    }
  }

  /**
   * Sync all registered DocTypes.
   */
  async syncAll(): Promise<void> {
    const all = this.registry.getAll();
    this.logger.log(`Syncing ${all.length} registered DocType(s)...`);
    for (const docType of all) {
      await this.syncDocType(docType);
    }
    this.logger.log('All DocTypes synced successfully.');
  }

  private async createTable(knex: Knex, docType: DocType, tableName: string): Promise<void> {
    await knex.schema.createTable(tableName, (table) => {
      // Standard Frappe columns
      table.string('name', 140).primary();
      table.datetime('creation').notNullable();
      table.datetime('modified').notNullable();
      table.string('modified_by', 140).defaultTo('Administrator');
      table.string('owner', 140).defaultTo('Administrator');
      table.integer('docstatus').defaultTo(0);
      table.integer('idx').defaultTo(0);

      // Child table parent linkage columns
      if (docType.isChildTable) {
        table.string('parent', 140).nullable();
        table.string('parenttype', 140).nullable();
        table.string('parentfield', 140).nullable();
        table.index(['parent', 'parenttype', 'parentfield']);
      }

      // Submittable documents track amendment lineage
      if (docType.isSubmittable) {
        table.string('amended_from', 140).nullable();
      }

      // Per-table multi-tenant discriminator column
      if (docType.isTenantScoped) {
        table.string('tenant_id', 140).nullable().index();
      }

      // Add DocType fields
      for (const field of docType.fields) {
        this.addColumn(table, field);
      }
    });
  }

  private async alterTable(knex: Knex, docType: DocType, tableName: string): Promise<void> {
    const existingCols = await knex(tableName).columnInfo();
    const existingColNames = new Set(Object.keys(existingCols));

    if (docType.isSubmittable && !existingColNames.has('amended_from')) {
      await knex.schema.alterTable(tableName, (table) => {
        table.string('amended_from', 140).nullable();
      });
      existingColNames.add('amended_from');
    }

    if (docType.isTenantScoped && !existingColNames.has('tenant_id')) {
      await knex.schema.alterTable(tableName, (table) => {
        table.string('tenant_id', 140).nullable().index();
      });
      existingColNames.add('tenant_id');
    }

    // Determine missing columns
    const missingFields: DocField[] = [];
    for (const field of docType.fields) {
      if (field.fieldtype === 'Table') continue;
      if (!existingColNames.has(field.fieldname)) {
        missingFields.push(field);
      }
    }

    if (missingFields.length > 0) {
      await knex.schema.alterTable(tableName, (table) => {
        for (const field of missingFields) {
          this.addColumn(table, field);
          this.logger.log(`Added column [${field.fieldname}] to [${tableName}]`);
        }
      });
    }
  }

  private addColumn(table: Knex.CreateTableBuilder, field: DocField): void {
    const { fieldname, fieldtype, length, default: defaultValue, unique } = field;

    // Table / child table fields do not get their own column on the parent table
    if (fieldtype === 'Table') {
      return;
    }

    let col: Knex.ColumnBuilder;

    switch (fieldtype) {
      case 'Int':
        col = table.integer(fieldname);
        break;

      case 'Float':
      case 'Currency':
      case 'Percent':
        col = table.float(fieldname);
        break;

      case 'Check':
        col = table.integer(fieldname).defaultTo(0);
        break;

      case 'Date':
        col = table.date(fieldname);
        break;

      case 'Datetime':
        col = table.datetime(fieldname);
        break;

      case 'Time':
        col = table.time(fieldname);
        break;

      case 'Text':
      case 'Small Text':
      case 'Long Text':
      case 'Code':
        col = table.text(fieldname);
        break;

      case 'Data':
      case 'Select':
      case 'Link':
      case 'Password':
      default:
        col = table.string(fieldname, length || 255);
        break;
    }

    if (unique) {
      col.unique();
    }

    if (defaultValue !== undefined) {
      col.defaultTo(defaultValue);
    } else {
      col.nullable();
    }
  }
}
