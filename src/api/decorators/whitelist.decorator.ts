import 'reflect-metadata';
import { MethodOptions } from '../method-registry.service';

export const WHITELIST_METADATA = 'FRAFFE_WHITELIST_METADATA';

export interface WhitelistOptions extends MethodOptions {
  /**
   * Custom exposed RPC method name (e.g. "my_app.calculate_total").
   * Defaults to the property/method name.
   */
  name?: string;
}

export interface WhitelistEntry {
  name: string;
  propertyKey: string | symbol;
  options: MethodOptions;
  handler: (...args: any[]) => any;
}

/**
 * Decorator to expose a service or controller method as a Frappe RPC endpoint (/api/method/<name>).
 *
 * Example:
 * ```ts
 * @Injectable()
 * export class OrderService {
 *   constructor(private readonly docService: DocumentService) {}
 *
 *   @Whitelist({ name: 'orders.calculate_discount', isPublic: false })
 *   async calculateDiscount(params: { orderId: string; promoCode: string }) {
 *     const order = await this.docService.getDoc('Order', params.orderId);
 *     return { discount: 15 };
 *   }
 * }
 * ```
 */
export function Whitelist(options: WhitelistOptions = {}): MethodDecorator {
  return (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
    const methodName = options.name || String(propertyKey);
    const entry: WhitelistEntry = {
      name: methodName,
      propertyKey,
      options: {
        isPublic: options.isPublic ?? false,
      },
      handler: descriptor.value,
    };

    Reflect.defineMetadata(WHITELIST_METADATA, entry, descriptor.value);

    // Register on the class constructor metadata
    const constructor = target.constructor;
    const existingList: WhitelistEntry[] = Reflect.getMetadata(WHITELIST_METADATA, constructor) || [];
    existingList.push(entry);
    Reflect.defineMetadata(WHITELIST_METADATA, existingList, constructor);
  };
}
