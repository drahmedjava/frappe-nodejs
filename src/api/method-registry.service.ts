import { Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser } from '../auth/types';

export type MethodHandler = (params: any, context: { user: AuthUser }) => Promise<any> | any;

export interface MethodOptions {
  isPublic?: boolean;
}

interface RegisteredMethod {
  handler: MethodHandler;
  options: MethodOptions;
}

@Injectable()
export class MethodRegistryService {
  private readonly methods = new Map<string, RegisteredMethod>();

  register(name: string, handler: MethodHandler, options: MethodOptions = {}): void {
    this.methods.set(name, { handler, options });
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
}
