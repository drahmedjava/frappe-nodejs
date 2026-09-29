import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DocumentEventPayload } from './types';
import { ON_DOC_EVENT_METADATA, DocEventHookEntry } from './decorators/on-doc-event.decorator';

@Injectable()
export class DocumentEventsService {
  private readonly emitter = new EventEmitter();

  emit(event: string, payload: DocumentEventPayload): void {
    // Specific event: e.g. "Task:after_save"
    this.emitter.emit(`${payload.doctype}:${event}`, payload);
    // Generic event: e.g. "doc:after_save"
    this.emitter.emit(`doc:${event}`, payload);
  }

  async emitAsync(event: string, payload: DocumentEventPayload): Promise<void> {
    const specific = this.emitter.listeners(`${payload.doctype}:${event}`);
    const generic = this.emitter.listeners(`doc:${event}`);
    for (const listener of [...specific, ...generic]) {
      await listener(payload);
    }
  }

  on(event: string, listener: (payload: DocumentEventPayload) => Promise<void> | void): void {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (payload: DocumentEventPayload) => Promise<void> | void): void {
    this.emitter.off(event, listener);
  }

  /**
   * Scans an object instance (service or listener) for @OnDocEvent() decorated methods
   * and registers each hook bound to the instance.
   */
  registerInstance(instance: any): void {
    if (!instance || typeof instance !== 'object') return;
    const constructor = instance.constructor;
    const entries: DocEventHookEntry[] = Reflect.getMetadata(ON_DOC_EVENT_METADATA, constructor) || [];

    for (const entry of entries) {
      const bound = entry.handler.bind(instance);
      if (entry.doctype === '*' || !entry.doctype) {
        this.on(`doc:${entry.event}`, bound);
      } else {
        this.on(`${entry.doctype}:${entry.event}`, bound);
      }
    }
  }
}
