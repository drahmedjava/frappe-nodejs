import { Injectable, Optional } from '@nestjs/common';
import { DocumentService } from '../document/document.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SiteContextService } from '../tenant/site-context.service';
import { BaseDocument } from '../document/base-document';
import { GetListOptions } from '../document/types';
import { DocType } from '../meta/types';

/**
 * Abstract Base Class for custom business controllers.
 * Injects DocumentService and provides high-level helpers to access, query, create,
 * and manipulate any DocType in the system with full multi-tenant and multi-site isolation.
 *
 * Example:
 * ```ts
 * @Controller('api/custom/inventory')
 * export class InventoryController extends BaseCustomController {
 *   constructor(
 *     docService: DocumentService,
 *     registry?: DocTypeRegistryService,
 *     siteContext?: SiteContextService,
 *   ) {
 *     super(docService, registry, siteContext);
 *   }
 *
 *   @Post('reorder')
 *   async reorderStock(@Body() body: { itemCode: string; qty: number }) {
 *     const item = await this.getDoc('Item', body.itemCode);
 *     const po = this.newDoc('PurchaseOrder', {
 *       supplier: item.get('default_supplier'),
 *       items: [{ item_code: item.name, qty: body.qty }],
 *     });
 *     await po.insert();
 *     return po.asJson();
 *   }
 * }
 * ```
 */
@Injectable()
export abstract class BaseCustomController {
  constructor(
    protected readonly docService: DocumentService,
    @Optional() protected readonly registry?: DocTypeRegistryService,
    @Optional() protected readonly siteContext?: SiteContextService,
  ) {}

  /**
   * Fetches an existing document of any DocType with child tables and validation.
   */
  async getDoc<T extends BaseDocument = BaseDocument>(doctype: string, name: string): Promise<T> {
    return this.docService.getDoc<T>(doctype, name);
  }

  /**
   * Creates a new in-memory document of any DocType.
   */
  newDoc<T extends BaseDocument = BaseDocument>(doctype: string, data: Record<string, any> = {}): T {
    return this.docService.newDoc<T>(doctype, data);
  }

  /**
   * Queries list of documents for any DocType with filtering, auto-scoping, and pagination.
   */
  async getList(doctype: string, options: GetListOptions = {}): Promise<any[]> {
    return this.docService.getList(doctype, options);
  }

  /**
   * Deletes a document of any DocType.
   */
  async deleteDoc(doctype: string, name: string): Promise<void> {
    await this.docService.deleteDoc(doctype, name);
  }

  /**
   * Returns current active multi-site name from context, or undefined.
   */
  getActiveSite(): string | undefined {
    return this.siteContext?.getCurrentSite();
  }

  /**
   * Returns current active per-table tenant ID from context, or undefined.
   */
  getActiveTenantId(): string | undefined {
    return this.siteContext?.getCurrentTenantId();
  }

  /**
   * Returns true if DocType exists in metadata registry.
   */
  hasDocType(doctype: string): boolean {
    if (!this.registry) {
      throw new Error('DocTypeRegistryService is not injected in BaseCustomController');
    }
    return this.registry.has(doctype);
  }

  /**
   * Returns DocType metadata schema.
   */
  getDocTypeMeta(doctype: string): DocType {
    if (!this.registry) {
      throw new Error('DocTypeRegistryService is not injected in BaseCustomController');
    }
    return this.registry.get(doctype);
  }
}
