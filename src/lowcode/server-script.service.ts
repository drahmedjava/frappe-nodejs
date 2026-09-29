import { Injectable, Logger, OnModuleInit, NotFoundException, Optional } from '@nestjs/common';
import * as vm from 'vm';
import { DatabaseService } from '../database/database.service';
import { DocumentEventsService } from '../document/document-events.service';
import { DocumentService } from '../document/document.service';
import { BaseDocument } from '../document/base-document';
import { AuthUser } from '../auth/types';

@Injectable()
export class ServerScriptService implements OnModuleInit {
  private readonly logger = new Logger(ServerScriptService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly docEvents: DocumentEventsService,
    @Optional() private readonly docService?: DocumentService,
  ) {}

  onModuleInit() {
    const events = ['before_insert', 'validate', 'before_save', 'after_save', 'before_delete', 'after_delete'];
    for (const evt of events) {
      this.docEvents.on(`doc:${evt}`, async (payload) => {
        await this.handleDocEvent(payload.doctype, evt, payload.doc);
      });
    }
  }

  async handleDocEvent(doctype: string, event: string, doc: BaseDocument): Promise<void> {
    const knex = this.db.getKnex();
    const hasTable = await knex.schema.hasTable('tabServerScript');
    if (!hasTable) return;

    const scripts = await this.db
      .table('tabServerScript')
      .where({
        script_type: 'DocType Event',
        reference_doctype: doctype,
        doctype_event: event,
        disabled: 0,
      });

    for (const scriptRow of scripts) {
      await this.executeScript(scriptRow.script, doc);
    }
  }

  /**
   * Executes a Server Script configured as script_type === 'API'.
   */
  async executeApiMethod(methodName: string, params: Record<string, any>, user: AuthUser): Promise<any> {
    const knex = this.db.getKnex();
    const hasTable = await knex.schema.hasTable('tabServerScript');
    if (!hasTable) {
      throw new NotFoundException(`Method "${methodName}" not found`);
    }

    const scriptRow = await this.db
      .table('tabServerScript')
      .where({
        script_type: 'API',
        api_method: methodName,
        disabled: 0,
      })
      .first();

    if (!scriptRow) {
      throw new NotFoundException(`Method "${methodName}" not found`);
    }

    return this.executeScript(scriptRow.script, null, {
      params,
      form_dict: params,
      user,
    });
  }

  /**
   * Executes arbitrary user script in a sandboxed Node VM with full Frappe API support.
   */
  async executeScript(code: string, doc: any, extraContext: Record<string, any> = {}): Promise<any> {
    const logs: string[] = [];
    const response: Record<string, any> = {};
    const flags: Record<string, any> = {};

    const frappe = {
      form_dict: extraContext.form_dict || extraContext.params || {},
      params: extraContext.params || {},
      response,
      flags,
      session: {
        user: extraContext.user?.user || 'Administrator',
      },
      msgprint: (msg: any) => logs.push(String(msg)),
      throw: (msg: string) => {
        throw new Error(msg);
      },
      log: (msg: any) => this.logger.log(`[Script]: ${JSON.stringify(msg)}`),
      db: {
        get_value: async (doctype: string, filters: any, fieldname: string | string[]) => {
          const filterObj = typeof filters === 'string' ? { name: filters } : filters;
          const row = await this.db.table(`tab${doctype}`).where(filterObj).first();
          if (!row) return null;
          if (Array.isArray(fieldname)) {
            const res: Record<string, any> = {};
            for (const f of fieldname) res[f] = row[f];
            return res;
          }
          return row[fieldname];
        },
        set_value: async (doctype: string, name: string, fieldname: string | Record<string, any>, value?: any) => {
          const updates = typeof fieldname === 'object' ? fieldname : { [fieldname]: value };
          await this.db.table(`tab${doctype}`).where({ name }).update(updates);
        },
        get_list: async (doctype: string, options: any = {}) => {
          if (!this.docService) throw new Error('DocumentService is not available');
          return this.docService.getList(doctype, options);
        },
        count: async (doctype: string, filters: any = {}) => {
          const res = await this.db.table(`tab${doctype}`).where(filters).count<{ count: number }[]>('* as count');
          return Number(res[0]?.count || 0);
        },
        sql: async (query: string, bindings: any[] = []) => {
          return this.db.sql(query, bindings);
        },
      },
      get_doc: async (doctype: string, name: string) => {
        if (!this.docService) throw new Error('DocumentService is not available');
        return this.docService.getDoc(doctype, name);
      },
      new_doc: (doctype: string, data: Record<string, any> = {}) => {
        if (!this.docService) throw new Error('DocumentService is not available');
        return this.docService.newDoc(doctype, data);
      },
      delete_doc: async (doctype: string, name: string) => {
        if (!this.docService) throw new Error('DocumentService is not available');
        return this.docService.deleteDoc(doctype, name);
      },
    };

    const sandbox = {
      doc,
      frappe,
      console: {
        log: (...args: any[]) => logs.push(args.map(String).join(' ')),
      },
      ...extraContext,
    };

    const context = vm.createContext(sandbox);
    // Wrap in async IIFE to support top-level await and return
    const wrappedCode = `(async () => {\n${code}\n})()`;
    const script = new vm.Script(wrappedCode);
    const result = await script.runInContext(context, { timeout: 5000 });

    if (result !== undefined) {
      return result;
    }
    if (response.message !== undefined) {
      return response.message;
    }
    if (Object.keys(response).length > 0) {
      return response;
    }
    return undefined;
  }
}
