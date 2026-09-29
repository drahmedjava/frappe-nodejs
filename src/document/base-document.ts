import { DocType } from '../meta/types';
import { DatabaseService } from '../database/database.service';
import { NamingService } from './naming.service';
import { DocValidatorService } from '../meta/doc-validator.service';
import { DocumentEventsService } from './document-events.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import * as crypto from 'crypto';

export interface DocumentContext {
  db: DatabaseService;
  naming: NamingService;
  validator: DocValidatorService;
  events: DocumentEventsService;
  registry: DocTypeRegistryService;
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

    // 3. Validation & Type Coercion
    this.data = this.validator.validate(this.meta, this.data, true);

    // 4. Lifecycle hooks
    await this.before_insert();
    this.events.emit('before_insert', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_insert' });

    await this.validate();
    this.events.emit('validate', { doctype: this.doctype, name: this.data.name, doc: this, event: 'validate' });

    await this.before_save();
    this.events.emit('before_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_save' });

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
    this.events.emit('after_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_save' });

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

    // Update audit fields
    const now = new Date().toISOString();
    this.data.modified = now;
    this.data.modified_by = user;

    // Validation & coercion
    this.data = this.validator.validate(this.meta, this.data, false);

    // Lifecycle hooks
    await this.validate();
    this.events.emit('validate', { doctype: this.doctype, name: this.data.name, doc: this, event: 'validate' });

    await this.before_save();
    this.events.emit('before_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_save' });

    const tableName = `tab${this.doctype}`;
    const { mainRow, childRowsByField } = this.separateChildTables();

    await this.db.transaction(async (trx) => {
      // Update main row
      await trx(tableName).where({ name: this.data.name }).update(mainRow);

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
    this.events.emit('after_save', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_save' });

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
    this.events.emit('before_submit', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_submit' });

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
    this.events.emit('on_submit', { doctype: this.doctype, name: this.data.name, doc: this, event: 'on_submit' });

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
    this.events.emit('before_cancel', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_cancel' });

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
    this.events.emit('on_cancel', { doctype: this.doctype, name: this.data.name, doc: this, event: 'on_cancel' });

    return this;
  }

  /**
   * Deletes the document and cascading child table rows.
   */
  async delete(): Promise<void> {
    if (this.data.docstatus === 1) {
      throw new Error(`Cannot delete submitted document "${this.data.name}". Cancel it first.`);
    }

    await this.before_delete();
    this.events.emit('before_delete', { doctype: this.doctype, name: this.data.name, doc: this, event: 'before_delete' });

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
    this.events.emit('after_delete', { doctype: this.doctype, name: this.data.name, doc: this, event: 'after_delete' });
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
