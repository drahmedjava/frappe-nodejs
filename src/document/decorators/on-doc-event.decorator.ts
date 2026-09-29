import 'reflect-metadata';

export const ON_DOC_EVENT_METADATA = 'FRAPPE_ON_DOC_EVENT_METADATA';

export interface DocEventHookEntry {
  doctype: string;
  event: string;
  propertyKey: string | symbol;
  handler: (payload: any) => Promise<void> | void;
}

/**
 * Decorator to register an event hook for document lifecycle events.
 *
 * Example:
 * ```ts
 * @Injectable()
 * export class AuditEventListener {
 *   @OnDocEvent('Task', 'after_save')
 *   async onTaskSaved(payload: DocumentEventPayload) {
 *     console.log('Task saved:', payload.doc.name);
 *   }
 *
 *   @OnDocEvent('*', 'before_delete')
 *   async onAnyDocDelete(payload: DocumentEventPayload) {
 *     console.log(`Document of type ${payload.doctype} is being deleted:`, payload.name);
 *   }
 * }
 * ```
 */
export function OnDocEvent(doctype: string, event: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const entry: DocEventHookEntry = {
      doctype,
      event,
      propertyKey,
      handler: descriptor.value,
    };

    const constructor = target.constructor;
    const existing: DocEventHookEntry[] = Reflect.getMetadata(ON_DOC_EVENT_METADATA, constructor) || [];
    existing.push(entry);
    Reflect.defineMetadata(ON_DOC_EVENT_METADATA, existing, constructor);
  };
}
