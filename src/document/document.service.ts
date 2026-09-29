import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocValidatorService } from '../meta/doc-validator.service';
import { NamingService } from './naming.service';
import { DocumentEventsService } from './document-events.service';
import { DocumentControllerRegistry } from './document-controller.registry';
import { BaseDocument, DocumentContext } from './base-document';
import { GetListOptions, FilterTriple } from './types';
import { SiteContextService } from '../tenant/site-context.service';

@Injectable()
export class DocumentService {
  private readonly context: DocumentContext;

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: DocTypeRegistryService,
    private readonly validator: DocValidatorService,
    private readonly naming: NamingService,
    private readonly events: DocumentEventsService,
    private readonly controllerRegistry: DocumentControllerRegistry,
    @Optional() private readonly siteContext?: SiteContextService,
  ) {
    this.context = {
      db: this.db,
      registry: this.registry,
      validator: this.validator,
      naming: this.naming,
      events: this.events,
      siteContext: this.siteContext,
      docService: this,
    };
  }

  /**
   * Creates an in-memory document instance (not yet saved to DB).
   */
  newDoc<T extends BaseDocument = BaseDocument>(doctype: string, data: Record<string, any> = {}): T {
    const meta = this.registry.get(doctype);
    const ControllerClass = this.controllerRegistry.get<T>(doctype);
    return new ControllerClass(meta, data, this.context, true) as T;
  }

  /**
   * Fetches an existing document and its child tables from the database.
   */
  async getDoc<T extends BaseDocument = BaseDocument>(doctype: string, name: string): Promise<T> {
    const meta = this.registry.get(doctype);
    const tableName = `tab${doctype}`;

    const row = await this.db.table(tableName).where({ name }).first();
    if (!row) {
      throw new NotFoundException(`Document ${doctype} "${name}" not found`);
    }

    // Auto-scope check for tenant-scoped DocTypes
    if (meta.isTenantScoped) {
      const activeTenant = this.siteContext?.getCurrentTenantId();
      if (activeTenant && row.tenant_id !== activeTenant) {
        throw new NotFoundException(`Document ${doctype} "${name}" not found`);
      }
    }

    // Load child tables
    const tableFields = meta.fields.filter((f) => f.fieldtype === 'Table');
    for (const field of tableFields) {
      const childDocType = field.options as string;
      if (childDocType && this.registry.has(childDocType)) {
        const childTableName = `tab${childDocType}`;
        const childRows = await this.db
          .table(childTableName)
          .where({
            parent: name,
            parentfield: field.fieldname,
          })
          .orderBy('idx', 'asc');

        row[field.fieldname] = childRows;
      }
    }

    const ControllerClass = this.controllerRegistry.get<T>(doctype);
    return new ControllerClass(meta, row, this.context, false) as T;
  }

  /**
   * Queries list of documents with filtering, field selection, ordering, and pagination.
   */
  async getList(doctype: string, options: GetListOptions = {}): Promise<any[]> {
    const meta = this.registry.get(doctype);
    const tableName = `tab${doctype}`;
    const query = this.db.table(tableName);

    // 1. Column Selection
    const tableFieldNames = new Set(
      meta.fields.filter((f) => f.fieldtype === 'Table').map((f) => f.fieldname),
    );

    if (options.fields && options.fields.length > 0) {
      // Exclude Table fields from direct SQL column selection
      const sqlFields = options.fields.filter((f) => !tableFieldNames.has(f));
      query.select(sqlFields.length > 0 ? sqlFields : ['name']);
    } else {
      query.select('*');
    }

    // Tenant-scoping filter
    if (meta.isTenantScoped) {
      const activeTenant = this.siteContext?.getCurrentTenantId();
      if (activeTenant) {
        query.where(`${tableName}.tenant_id`, activeTenant);
      }
    }

    // 2. Filters
    if (options.filters) {
      if (Array.isArray(options.filters)) {
        for (const filter of options.filters as FilterTriple[]) {
          if (Array.isArray(filter) && filter.length === 3) {
            const [field, op, val] = filter;
            if (op.toLowerCase() === 'in') {
              query.whereIn(field, Array.isArray(val) ? val : [val]);
            } else if (op.toLowerCase() === 'not in') {
              query.whereNotIn(field, Array.isArray(val) ? val : [val]);
            } else if (op.toLowerCase() === 'like') {
              query.where(field, 'like', val);
            } else {
              query.where(field, op, val);
            }
          }
        }
      } else if (typeof options.filters === 'object') {
        query.where(options.filters);
      }
    }

    if (options.whereIn) {
      for (const [col, vals] of Object.entries(options.whereIn)) {
        query.whereIn(col, vals);
      }
    }

    // 3. Ordering
    if (options.orderBy) {
      const [col, direction] = options.orderBy.split(/\s+/);
      query.orderBy(col, (direction?.toLowerCase() === 'asc' ? 'asc' : 'desc') as any);
    } else {
      query.orderBy('creation', 'desc');
    }

    // 4. Pagination
    if (options.limit !== undefined) {
      query.limit(options.limit);
    }
    if (options.offset !== undefined) {
      query.offset(options.offset);
    }

    return query;
  }

  /**
   * Deletes a document by DocType and name.
   */
  async deleteDoc(doctype: string, name: string): Promise<void> {
    const doc = await this.getDoc(doctype, name);
    await doc.delete();
  }
}
