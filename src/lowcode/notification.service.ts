import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as vm from 'vm';
import { DatabaseService } from '../database/database.service';
import { DocumentEventsService } from '../document/document-events.service';
import { RealtimeService } from '../async/realtime.service';
import { QueueService } from '../async/queue.service';
import { BaseDocument } from '../document/base-document';

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly docEvents: DocumentEventsService,
    private readonly realtime: RealtimeService,
    private readonly queue: QueueService,
  ) {}

  onModuleInit() {
    this.docEvents.on('doc:after_save', async (payload) => {
      await this.processEvent('after_save', payload.doctype, payload.doc);
    });

    this.docEvents.on('doc:after_delete', async (payload) => {
      await this.processEvent('after_delete', payload.doctype, payload.doc);
    });
  }

  async processEvent(event: string, doctype: string, doc: BaseDocument): Promise<void> {
    const knex = this.db.getKnex();
    const hasTable = await knex.schema.hasTable('tabNotificationRule');
    if (!hasTable) return;

    const rules = await this.db.table('tabNotificationRule').where({
      document_type: doctype,
      event,
      disabled: 0,
    });

    for (const rule of rules) {
      let isMatch = true;

      if (rule.condition) {
        try {
          isMatch = Boolean(
            vm.runInNewContext(rule.condition, { doc: doc.asJson() }, { timeout: 500 }),
          );
        } catch (err: any) {
          this.logger.warn(`Failed evaluating condition for rule ${rule.name}: ${err.message}`);
          isMatch = false;
        }
      }

      if (isMatch) {
        const payload = {
          rule: rule.name,
          message: rule.message,
          doctype: doc.doctype,
          docname: doc.name,
        };

        if (rule.channel === 'Realtime') {
          this.realtime.publishRealtime('notification', payload, { doctype: doc.doctype });
        } else if (rule.channel === 'Queue') {
          await this.queue.enqueue('send_notification', payload);
        }
      }
    }
  }
}
