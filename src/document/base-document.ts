import { DocType } from '../meta/types';
import { DatabaseService } from '../database/database.service';
import { NamingService } from './naming.service';
import { DocValidatorService } from '../meta/doc-validator.service';
import { DocumentEventsService } from './document-events.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SiteContextService } from '../tenant/site-context.service';
import * as crypto from 'crypto';

export interface DocumentContext {
  db: DatabaseService;
  naming: NamingService;
  validator: DocValidatorService;
  events: DocumentEventsService;
  registry: DocTypeRegistryService;
  siteContext?: SiteContextService;
}

export class BaseDocument {
  [key: string]: any;

  public doctype: string;
  public meta: DocType;
  public data: Record<string, any>;
  public isNew: boolean;

  get name(): string {
    return this.data?.name;
  }
  set name(val: string) {
    if (!this.data) this.data = {};
    this.data.name = val;
  }

  get docstatus(): number {
    return this.data?.docstatus;
  }
  set docstatus(val: number) {
    if (!this.data) this.data = {};
    this.data.docstatus = val;
  }

  get creation(): string {
    return this.data?.creation;
  }
  set creation(val: string) {
    if (!this.data) this.data = {};
    this.data.creation = val;
  }

  get modified(): string {
    return this.data?.modified;
  }
  set modified(val: string) {
    if (!this.data) this.data = {};
    this.data.modified = val;
  }

  get owner(): string {
    return this.data?.owner;
  }
  set owner(val: string) {
    if (!this.data) this.data = {};
    this.data.owner = val;
  }

  get modified_by(): string {
    return this.data?.modified_by;
  }
  set modified_by(val: string) {
    if (!this.data) this.data = {};
    this.data.modified_by = val;
  }

  get idx(): number {
    return this.data?.idx;
  }
  set idx(val: number) {
    if (!this.data) this.data = {};
    this.data.idx = val;
  }

  get amended_from(): string | undefined {
    return this.data?.amended_from;
  }
  set amended_from(val: string | undefined) {
    if (!this.data) this.data = {};
    this.data.amended_from = val;
  }

  get tenant_id(): string | undefined {
    return this.data?.tenant_id;
  }
  set tenant_id(val: string | undefined) {
    if (!this.data) this.data = {};
    this.data.tenant_id = val;
  }

  protected context: DocumentContext;
  protected db: DatabaseService;
  protected naming: NamingService;
  protected validator: DocValidatorService;
  protected events: DocumentEventsService;
  protected registry: DocTypeRegistryService;

  constructor(
    meta: DocType,
    initialData: Record<string, any> = {},
    context: DocumentContext,
    isNew = true,
  ) {
    this.doctype = meta.name;
    this.meta = meta;
    this.data = { ...initialData };
    this.isNew = isNew;

    this.context = context;
    this.db = context.db;
    this.naming = context.naming;
    this.validator = context.validator;
    this.events = context.events;
    this.registry = context.registry;

    // Return a Proxy so doc.field directly reads and writes doc.data.field
    return new Proxy(this, {
      get(target: any, prop: string | symbol) {
        if (prop in target) {
          return target[prop];
        }
        if (typeof prop === 'string') {
          return target.data[prop];
        }
        return undefined;
      },
      set(target: any, prop: string | symbol, value: any) {
        if (prop in target) {
          target[prop] = value;
        } else if (typeof prop === 'string') {
          target.data[prop] = value;
        }
        return true;
      },
    });
  }

  // Getters & Setters
  get(prop: string): any {
    return this.data[prop];
  }

  set(prop: string, value: any): void {
    this.data[prop] = value;
  }

  // Lifecycle hooks to be overridden in custom document classes
  async before_insert(): Promise<void> {}
  async validate(): Promise<void> {}
  async before_save(): Promise<void> {}
  async after_save(): Promise<void> {}
  async before_delete(): Promise<void> {}
  async after_delete(): Promise<void> {}
  async before_submit(): Promise<void> {}
  async on_submit(): Promise<void> {}
  async before_cancel(): Promise<void> {}
  async on_cancel(): Promise<void> {}

  /**
   * Inserts a new document into the database.
   */
  async insert(user = 'Administrator'): Promise<this> {
    if (!this.isNew) {
      throw new Error(`Cannot insert existing document "${this.data.name}"`);
    }

    // 1. Generate name if not present
    if (!this.data.name) {
      this.data.name = await this.naming.generateName(this.meta, this.data);
    }

    // 2. Set Frappe audit fields
    const now = new Date().toISOString();
    this.data.creation = now;
    this.data.modified = now;
    this.data.owner = this.data.owner || user;
    this.data.modified_by = user;
    this.data.docstatus = 0; // Draft
    this.data.idx = this.data.idx || 0;

    // Auto-stamp tenant_id for tenant-scoped DocTypes
    if (this.meta.isTenantScoped) {
      const activeTenant = this.context.siteContext?.getCurrentTenantId();
      if (activeTenant) {
        this.data.tenant_id = activeTenant;
      }
    }

    // 3. Validation & Type Coercion
    this.data = this.validator.validate(this.meta, this.data, true);

    // 4. Lifecycle hooks
    await this.before_insert();
    await this.events.emitAsync('before_insert', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_insert' });

    await this.validate();
    await this.events.emitAsync('validate', { doctype: this.doctype, name: this.data.name, doc: this, event: 'validate' });

    await this.before_save();
    await this.events.emitAsync('before_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_save' });

    // 5. Database transaction
    const tableName = `tab${this.doctype}`;
    const { mainRow, childRowsByField } = this.separateChildTables();

    await this.db.transaction(async (trx) => {
      // Insert main document
      await trx(tableName).insert(mainRow);

      // Insert child tables
      for (const [parentfield, rows] of Object.entries(childRowsByField)) {
        const fieldMeta = this.meta.fields.find((f) => f.fieldname === parentfield);
        const childDocTypeName = fieldMeta?.options as string;
        const childTableName = `tab${childDocTypeName}`;

        for (let i = 0; i < rows.length; i++) {
          const childRow = { ...rows[i] };
          childRow.name = childRow.name || crypto.randomBytes(5).toString('hex');
          childRow.parent = this.data.name;
          childRow.parenttype = this.doctype;
          childRow.parentfield = parentfield;
          childRow.idx = i + 1;
          childRow.creation = now;
          childRow.modified = now;
          childRow.owner = user;
          childRow.modified_by = user;
          childRow.docstatus = this.data.docstatus;

          await trx(childTableName).insert(childRow);
        }
      }
    });

    this.isNew = false;

    // 6. After save hooks
    await this.after_save();
    await this.events.emitAsync('after_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_save' });

    return this;
  }

  /**
   * Saves an existing document (or inserts if new).
   */
  async save(user = 'Administrator'): Promise<this> {
    if (this.isNew) {
      return this.insert(user);
    }

    if (this.data.docstatus === 1) {
      throw new Error(`Cannot edit submitted document "${this.data.name}". Cancel it first or submit an amendment.`);
    }

    if (this.data.docstatus === 2) {
      throw new Error(`Cannot edit cancelled document "${this.data.name}".`);
    }

    if (this.meta.isTenantScoped) {
      const activeTenant = this.context.siteContext?.getCurrentTenantId();
      if (activeTenant && this.data.tenant_id && this.data.tenant_id !== activeTenant) {
        throw new Error(`Permission denied: Document does not belong to tenant "${activeTenant}"`);
      }
      if (activeTenant) {
        this.data.tenant_id = activeTenant;
      }
    }

    // Update audit fields
    const now = new Date().toISOString();
    this.data.modified = now;
    this.data.modified_by = user;

    // Validation & coercion
    this.data = this.validator.validate(this.meta, this.data, false);

    // Lifecycle hooks
    await this.validate();
    await this.events.emitAsync('validate', { doctype: this.doctype, name: this.data.name, doc: this, event: 'validate' });

    await this.before_save();
    await this.events.emitAsync('before_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_save' });

    const tableName = `tab${this.doctype}`;
    const { mainRow, childRowsByField } = this.separateChildTables();

    // 1. Version tracking diff on existing document before transaction
    let versionDiff: any = null;
    let verName: string | null = null;
    if (this.doctype !== 'Version' && this.registry.has('Version')) {
      const hasTable = await this.db.hasTable('tabVersion');
      if (hasTable) {
        const existingRow = await this.db.table(tableName).where({ name: this.data.name }).first();
        if (existingRow) {
          const changed: Array<[string, any, any]> = [];
          const ignored = new Set(['creation', 'modified', 'modified_by', 'idx', 'docstatus']);
          for (const field of this.meta.fields) {
            if (field.fieldtype === 'Table' || field.fieldtype === 'Password' || ignored.has(field.fieldname)) {
              continue;
            }
            const oldVal = existingRow[field.fieldname];
            const newVal = mainRow[field.fieldname];
            const oldNorm = oldVal === undefined || oldVal === null ? null : oldVal;
            const newNorm = newVal === undefined || newVal === null ? null : newVal;
            if (oldNorm !== newNorm) {
              changed.push([field.fieldname, oldNorm, newNorm]);
            }
          }
          if (changed.length > 0) {
            versionDiff = { changed };
            const versionMeta = this.registry.get('Version');
            verName = await this.naming.generateName(versionMeta, {});
          }
        }
      }
    }

    await this.db.transaction(async (trx) => {
      // Update main row
      await trx(tableName).where({ name: this.data.name }).update(mainRow);

      // Record version if diff exists
      if (versionDiff && verName) {
        await trx('tabVersion').insert({
          name: verName,
          ref_doctype: this.doctype,
          docname: this.data.name,
          data: JSON.stringify(versionDiff),
          owner: user,
          modified_by: user,
          creation: now,
          modified: now,
          docstatus: 0,
          idx: 0,
        });
      }

      // Sync child tables: delete old child records and re-insert updated list
      for (const [parentfield, rows] of Object.entries(childRowsByField)) {
        const fieldMeta = this.meta.fields.find((f) => f.fieldname === parentfield);
        const childDocTypeName = fieldMeta?.options as string;
        const childTableName = `tab${childDocTypeName}`;

        // Remove old child records
        await trx(childTableName).where({
          parent: this.data.name,
          parentfield,
        }).delete();

        // Re-insert rows
        for (let i = 0; i < rows.length; i++) {
          const childRow = { ...rows[i] };
          childRow.name = childRow.name || crypto.randomBytes(5).toString('hex');
          childRow.parent = this.data.name;
          childRow.parenttype = this.doctype;
          childRow.parentfield = parentfield;
          childRow.idx = i + 1;
          childRow.creation = childRow.creation || now;
          childRow.modified = now;
          childRow.owner = childRow.owner || user;
          childRow.modified_by = user;
          childRow.docstatus = this.data.docstatus;

          await trx(childTableName).insert(childRow);
        }
      }
    });

    await this.after_save();
    await this.events.emitAsync('after_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_save' });

    return this;
  }

  /**
   * Submits a submittable document (draft -> submitted).
   */
  async submit(user = 'Administrator'): Promise<this> {
    if (!this.meta.isSubmittable) {
      throw new Error(`DocType "${this.doctype}" is not submittable`);
    }

    if (this.data.docstatus !== 0) {
      throw new Error(`Only draft documents can be submitted. Current docstatus: ${this.data.docstatus}`);
    }

    await this.before_submit();
    await this.events.emitAsync('before_submit', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_submit' });

    this.data.docstatus = 1;
    this.data.modified = new Date().toISOString();
    this.data.modified_by = user;

    const tableName = `tab${this.doctype}`;
    await this.db.transaction(async (trx) => {
      await trx(tableName).where({ name: this.data.name }).update({
        docstatus: 1,
        modified: this.data.modified,
        modified_by: this.data.modified_by,
      });

      // Update child tables docstatus
      for (const field of this.meta.fields) {
        if (field.fieldtype === 'Table' && typeof field.options === 'string') {
          const childTable = `tab${field.options}`;
          await trx(childTable).where({ parent: this.data.name }).update({ docstatus: 1 });
        }
      }
    });

    await this.on_submit();
    await this.events.emitAsync('on_submit', { doctype: this.doctype, name: this.data.name, doc: this, event: 'on_submit' });

    return this;
  }

  /**
   * Cancels a submitted document (submitted -> cancelled).
   */
  async cancel(user = 'Administrator'): Promise<this> {
    if (this.data.docstatus !== 1) {
      throw new Error(`Only submitted documents can be cancelled. Current docstatus: ${this.data.docstatus}`);
    }

    await this.before_cancel();
    await this.events.emitAsync('before_cancel', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_cancel' });

    this.data.docstatus = 2;
    this.data.modified = new Date().toISOString();
    this.data.modified_by = user;

    const tableName = `tab${this.doctype}`;
    await this.db.transaction(async (trx) => {
      await trx(tableName).where({ name: this.data.name }).update({
        docstatus: 2,
        modified: this.data.modified,
        modified_by: this.data.modified_by,
      });

      // Update child tables docstatus
      for (const field of this.meta.fields) {
        if (field.fieldtype === 'Table' && typeof field.options === 'string') {
          const childTable = `tab${field.options}`;
          await trx(childTable).where({ parent: this.data.name }).update({ docstatus: 2 });
        }
      }
    });

    await this.on_cancel();
    await this.events.emitAsync('on_cancel', { doctype: this.doctype, name: this.data.name, doc: this, event: 'on_cancel' });

    return this;
  }

  /**
   * Deletes the document and cascading child table rows.
   */
  async delete(): Promise<void> {
    if (this.data.docstatus === 1) {
      throw new Error(`Cannot delete submitted document "${this.data.name}". Cancel it first.`);
    }

    if (this.meta.isTenantScoped) {
      const activeTenant = this.context.siteContext?.getCurrentTenantId();
      if (activeTenant && this.data.tenant_id && this.data.tenant_id !== activeTenant) {
        throw new Error(`Permission denied: Document does not belong to tenant "${activeTenant}"`);
      }
    }

    await this.before_delete();
    await this.events.emitAsync('before_delete', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_delete' });

    const tableName = `tab${this.doctype}`;
    await this.db.transaction(async (trx) => {
      // Delete child rows
      for (const field of this.meta.fields) {
        if (field.fieldtype === 'Table' && typeof field.options === 'string') {
          const childTable = `tab${field.options}`;
          await trx(childTable).where({ parent: this.data.name }).delete();
        }
      }

      // Delete main document
      await trx(tableName).where({ name: this.data.name }).delete();
    });

    await this.after_delete();
    await this.events.emitAsync('after_delete', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_delete' });
  }

  /**
   * Amends a cancelled submittable document.
   * Clones doc, generates amendment name (e.g. DOC-00001-1), sets amended_from, resets docstatus to 0.
   */
  async amend(user = 'Administrator', save = true): Promise<this> {
    if (!this.meta.isSubmittable) {
      throw new Error(`DocType "${this.doctype}" is not submittable`);
    }

    if (this.data.docstatus !== 2) {
      throw new Error(`Only cancelled documents can be amended. Current docstatus: ${this.data.docstatus}`);
    }

    // Determine new amendment name
    let newName: string;
    if (this.data.amended_from) {
      const match = this.data.name.match(/^(.*)-(\d+)$/);
      if (match) {
        const base = match[1];
        const count = parseInt(match[2], 10) + 1;
        newName = `${base}-${count}`;
      } else {
        newName = `${this.data.name}-1`;
      }
    } else {
      newName = `${this.data.name}-1`;
    }

    // Clone data
    const amendedData: Record<string, any> = { ...this.data };
    delete amendedData.creation;
    delete amendedData.modified;
    delete amendedData.owner;
    delete amendedData.modified_by;

    amendedData.name = newName;
    amendedData.amended_from = this.data.name;
    amendedData.docstatus = 0; // Reset to Draft

    // Clone child table rows
    for (const field of this.meta.fields) {
      if (field.fieldtype === 'Table' && Array.isArray(amendedData[field.fieldname])) {
        amendedData[field.fieldname] = amendedData[field.fieldname].map((row: any) => {
          const clonedRow = { ...row };
          delete clonedRow.name;
          delete clonedRow.parent;
          delete clonedRow.creation;
          delete clonedRow.modified;
          delete clonedRow.owner;
          delete clonedRow.modified_by;
          clonedRow.docstatus = 0;
          return clonedRow;
        });
      }
    }

    const ControllerClass = this.constructor as any;
    const newDoc = new ControllerClass(this.meta, amendedData, this.context, true);

    if (save) {
      await newDoc.insert(user);
    }

    return newDoc;
  }

  /**
   * Fetches change history versions for this document.
   */
  async getVersions(): Promise<any[]> {
    if (!this.registry.has('Version')) return [];
    const hasTable = await this.db.hasTable('tabVersion');
    if (!hasTable) return [];

    const rows = await this.db
      .table('tabVersion')
      .where({ ref_doctype: this.doctype, docname: this.data.name })
      .orderBy('creation', 'desc');

    return rows.map((r: any) => ({
      ...r,
      data: typeof r.data === 'string' ? JSON.parse(r.data) : r.data,
    }));
  }

  /**
   * Returns clean plain JS object representation of the document.
   */
  asJson(): Record<string, any> {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Separates child tables from the main table columns for database queries.
   */
  private separateChildTables(): { mainRow: Record<string, any>; childRowsByField: Record<string, any[]> } {
    const mainRow: Record<string, any> = {};
    const childRowsByField: Record<string, any[]> = {};

    const tableFields = new Set(
      this.meta.fields.filter((f) => f.fieldtype === 'Table').map((f) => f.fieldname),
    );

    for (const [key, value] of Object.entries(this.data)) {
      if (tableFields.has(key)) {
        childRowsByField[key] = Array.isArray(value) ? value : [];
      } else {
        mainRow[key] = value;
      }
    }

    return { mainRow, childRowsByField };
  }
}
