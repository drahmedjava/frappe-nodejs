import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocType } from '../meta/types';
import { AuthUser } from './types';

@Injectable()
export class UserPermissionService {
  private readonly logger = new Logger(UserPermissionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: DocTypeRegistryService,
  ) {}

  /**
   * Retrieves all User Permissions for a specific user, grouped by allowed DocType.
   * e.g. { "Company": ["Acme Corp"], "User": ["alice@company.com"] }
   */
  async getUserPermissions(user: string): Promise<Record<string, string[]>> {
    const knex = this.db.getKnex();
    const hasTable = await knex.schema.hasTable('tabUserPermission');
    if (!hasTable) {
      return {};
    }

    const rows = await this.db.table('tabUserPermission')
      .where({ user })
      .select('allow', 'for_value');

    const permissions: Record<string, string[]> = {};
    for (const row of rows) {
      if (!permissions[row.allow]) {
        permissions[row.allow] = [];
      }
      permissions[row.allow].push(row.for_value);
    }

    return permissions;
  }

  /**
   * Builds SQL filter conditions based on User Permissions and "if_owner" rules.
   */
  async getPermissionFilters(
    docType: DocType,
    user: AuthUser,
  ): Promise<{ whereIn: Record<string, string[]>; where: Record<string, any> }> {
    const whereIn: Record<string, string[]> = {};
    const where: Record<string, any> = {};

    // Administrator and System Manager have bypass
    if (user.user === 'Administrator' || user.roles.includes('System Manager')) {
      return { whereIn, where };
    }

    // 1. Check if_owner rules
    const permissions = docType.permissions || [];
    const matchingPerms = permissions.filter((p) => user.roles.includes(p.role));

    // If all matching permissions require if_owner, enforce owner filter
    if (matchingPerms.length > 0 && matchingPerms.every((p) => p.if_owner === true)) {
      where['owner'] = user.user;
    }

    // 2. Check User Permissions
    const userPerms = await this.getUserPermissions(user.user);
    if (Object.keys(userPerms).length === 0) {
      return { whereIn, where };
    }

    // A. Direct permission on the DocType itself: e.g. allow = 'Task' -> where name IN (...)
    if (userPerms[docType.name]) {
      whereIn['name'] = userPerms[docType.name];
    }

    // B. Link fields on the DocType: e.g. assigned_to links to 'User', and allow = 'User'
    for (const field of docType.fields) {
      if (field.fieldtype === 'Link' && typeof field.options === 'string') {
        const targetDocType = field.options;
        if (userPerms[targetDocType]) {
          whereIn[field.fieldname] = userPerms[targetDocType];
        }
      }
    }

    return { whereIn, where };
  }

  /**
   * Verifies if a user can access a specific loaded document based on row-level security.
   */
  async checkDocRowPermission(docType: DocType, doc: Record<string, any>, user: AuthUser): Promise<boolean> {
    if (user.user === 'Administrator' || user.roles.includes('System Manager')) {
      return true;
    }

    const { where, whereIn } = await this.getPermissionFilters(docType, user);

    // Verify where equality matches
    for (const [key, val] of Object.entries(where)) {
      if (doc[key] !== val) {
        return false;
      }
    }

    // Verify whereIn matches
    for (const [key, allowedVals] of Object.entries(whereIn)) {
      const docVal = doc[key];
      if (docVal && !allowedVals.includes(docVal)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Redacts fields the user does not have permission level (permlevel) to read.
   */
  filterPermittedFields(
    docType: DocType,
    data: Record<string, any>,
    user: AuthUser,
  ): Record<string, any> {
    if (user.user === 'Administrator' || user.roles.includes('System Manager')) {
      return data;
    }

    // Find max permlevel user has for 'read'
    const permissions = docType.permissions || [];
    const matchingPerms = permissions.filter(
      (p) => user.roles.includes(p.role) && p.read === true,
    );

    const maxPermLevel = matchingPerms.reduce(
      (max, p) => Math.max(max, p.permlevel || 0),
      0,
    );

    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      const field = docType.fields.find((f) => f.fieldname === key);
      const fieldPermLevel = field?.permlevel || 0;

      // Keep audit fields and fields within allowed permlevel
      if (!field || fieldPermLevel <= maxPermLevel) {
        sanitized[key] = val;
      }
    }

    return sanitized;
  }
}
