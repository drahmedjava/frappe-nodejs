import { Injectable, ForbiddenException } from '@nestjs/common';
import { DocType } from '../meta/types';
import { AuthUser, PermissionAction } from './types';

@Injectable()
export class PermissionService {
  /**
   * Checks if user has permission to perform action on DocType.
   */
  hasPermission(
    docType: DocType,
    action: PermissionAction,
    user: AuthUser,
    _doc?: Record<string, any>,
  ): boolean {
    // 1. Administrator and System Manager have full permission
    if (user.user === 'Administrator' || user.roles.includes('System Manager')) {
      return true;
    }

    // 2. Check permissions array on DocType
    const permissions = docType.permissions || [];
    for (const perm of permissions) {
      if (user.roles.includes(perm.role)) {
        if (perm[action] === true) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Asserts permission, throwing ForbiddenException if not permitted.
   */
  assertPermission(
    docType: DocType,
    action: PermissionAction,
    user: AuthUser,
    doc?: Record<string, any>,
  ): void {
    if (!this.hasPermission(docType, action, user, doc)) {
      throw new ForbiddenException(
        `User "${user.user}" does not have "${action}" permission on DocType "${docType.name}"`,
      );
    }
  }
}
