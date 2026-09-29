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
  private readonly controllers = new Map<string, DocumentConstructor>();

  register<T extends BaseDocument>(doctype: string, controllerClass: DocumentConstructor<T>): void {
    this.controllers.set(doctype, controllerClass as any);
  }

  get<T extends BaseDocument = BaseDocument>(doctype: string): DocumentConstructor<T> {
    const controller = this.controllers.get(doctype);
    return (controller as DocumentConstructor<T>) || (BaseDocument as DocumentConstructor<T>);
  }

  has(doctype: string): boolean {
    return this.controllers.has(doctype);
  }
}
