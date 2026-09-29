import { Injectable } from '@nestjs/common';
import { EventEmitter } from 'events';
import { DocumentEventPayload } from './types';

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
}
