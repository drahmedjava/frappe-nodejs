import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { AuthUser } from '../auth/types';
import { WHITELIST_METADATA, WhitelistEntry } from './decorators/whitelist.decorator';

export type MethodHandler = (params: any, context: { user: AuthUser }) => Promise<any> | any;

export interface MethodOptions {
  isPublic?: boolean;
}

export interface RegisteredMethod {
  handler: MethodHandler;
  options: MethodOptions;
}

@Injectable()
export class MethodRegistryService {
  private readonly logger = new Logger(MethodRegistryService.name);
  private readonly methods = new Map<string, RegisteredMethod>();

  register(name: string, handler: MethodHandler, options: MethodOptions = {}): void {
    this.methods.set(name, { handler, options });
    this.logger.log(`Registered RPC method: [${name}] (public: ${!!options.isPublic})`);
  }

  /**
   * Scans an object instance (service or controller) for @Whitelist() decorated methods
   * and registers them with their handlers bound to the instance.
   */
  registerInstance(instance: any): void {
    if (!instance || typeof instance !== 'object') return;
    const constructor = instance.constructor;
    const entries: WhitelistEntry[] = Reflect.getMetadata(WHITELIST_METADATA, constructor) || [];

    for (const entry of entries) {
      const boundHandler = entry.handler.bind(instance);
      this.register(entry.name, boundHandler, entry.options);
    }
  }

  has(name: string): boolean {
    return this.methods.has(name);
  }

  get(name: string): RegisteredMethod {
    const method = this.methods.get(name);
    if (!method) {
      throw new NotFoundException(`Method "${name}" not found`);
    }
    return method;
  }

  getAll(): Map<string, RegisteredMethod> {
    return this.methods;
  }
}
