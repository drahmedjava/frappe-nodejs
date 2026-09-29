import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as vm from 'vm';
import { DatabaseService } from '../database/database.service';
import { DocumentEventsService } from '../document/document-events.service';
import { BaseDocument } from '../document/base-document';

@Injectable()
export class ServerScriptService implements OnModuleInit {
  private readonly logger = new Logger(ServerScriptService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly docEvents: DocumentEventsService,
  ) {}

  onModuleInit() {
    const events = ['before_insert', 'validate', 'before_save', 'after_save', 'before_delete'];
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
      this.executeScript(scriptRow.script, doc);
    }
  }

  /**
   * Executes arbitrary user script in a sandboxed Node VM.
   */
  executeScript(code: string, doc: any, extraContext: Record<string, any> = {}): any {
    const logs: string[] = [];

    const sandbox = {
      doc,
      frappe: {
        msgprint: (msg: any) => logs.push(String(msg)),
        throw: (msg: string) => {
          throw new Error(msg);
        },
        log: (msg: any) => this.logger.log(`[Script]: ${JSON.stringify(msg)}`),
      },
      console: {
        log: (...args: any[]) => logs.push(args.map(String).join(' ')),
      },
      ...extraContext,
    };

    const context = vm.createContext(sandbox);
    const script = new vm.Script(code);
    return script.runInContext(context, { timeout: 1000 });
  }
}
