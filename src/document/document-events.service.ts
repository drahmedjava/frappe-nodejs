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

  on(event: string, listener: (payload: DocumentEventPayload) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (payload: DocumentEventPayload) => void): void {
    this.emitter.off(event, listener);
  }
}
