import { Injectable } from '@nestjs/common';
import { BaseDocument, DocumentContext } from './base-document';
import { DocType } from '../meta/types';

export type DocumentConstructor<T extends BaseDocument = BaseDocument> = new (
  meta: DocType,
  data: Record<string, any>,
  context: DocumentContext,
  isNew: boolean,
) => T;

@Injectable()
export class DocumentControllerRegistry {
  private static readonly staticControllers = new Map<string, DocumentConstructor>();
  private readonly controllers = new Map<string, DocumentConstructor>();

  /**
   * Statically registers a document controller class (e.g. via @DocController decorator).
   */
  static register<T extends BaseDocument>(doctype: string, controllerClass: DocumentConstructor<T>): void {
    DocumentControllerRegistry.staticControllers.set(doctype, controllerClass as any);
  }

  /**
   * Registers a document controller class on this registry instance.
   */
  register<T extends BaseDocument>(doctype: string, controllerClass: DocumentConstructor<T>): void {
    this.controllers.set(doctype, controllerClass as any);
  }

  get<T extends BaseDocument = BaseDocument>(doctype: string): DocumentConstructor<T> {
    const controller = this.controllers.get(doctype) || DocumentControllerRegistry.staticControllers.get(doctype);
    return (controller as DocumentConstructor<T>) || (BaseDocument as DocumentConstructor<T>);
  }

  has(doctype: string): boolean {
    return this.controllers.has(doctype) || DocumentControllerRegistry.staticControllers.has(doctype);
  }
}

/**
 * Decorator to register a custom document controller for a DocType.
 *
 * Example:
 * ```ts
 * @DocController('Task')
 * export class TaskDocument extends BaseDocument {
 *   override async validate() {
 *     const user = await this.getDoc('User', this.owner);
 *   }
 * }
 * ```
 */
export function DocController(doctype: string): ClassDecorator {
  return (target: any) => {
    DocumentControllerRegistry.register(doctype, target);
  };
}
