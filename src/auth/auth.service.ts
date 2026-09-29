import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AuthUser } from './types';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly db: DatabaseService) {}

  /**
   * Resolves the current user from headers or defaults to Administrator / Guest.
   */
  async resolveUser(authHeader?: string, userHeader?: string): Promise<AuthUser> {
    // 1. Direct user header (for testing or gateway authentication)
    if (userHeader) {
      if (userHeader === 'Administrator') {
        return {
          user: 'Administrator',
          roles: ['System Manager', 'All'],
          isGuest: false,
        };
      }
      const roles = await this.getUserRoles(userHeader);
      return {
        user: userHeader,
        roles,
        isGuest: false,
      };
    }

    // 2. Token header: "token <api_key>:<api_secret>"
    if (authHeader && authHeader.toLowerCase().startsWith('token ')) {
      const tokenParts = authHeader.slice(6).trim().split(':');
      if (tokenParts.length === 2) {
        const [apiKey, apiSecret] = tokenParts;
        const user = await this.validateApiKey(apiKey, apiSecret);
        if (user) {
          const roles = await this.getUserRoles(user);
          return { user, roles, isGuest: false };
        }
      }
    }

    // 3. Bearer token (supports "Bearer Administrator" or token)
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === 'Administrator' || token === 'admin') {
        return {
          user: 'Administrator',
          roles: ['System Manager', 'All'],
          isGuest: false,
        };
      }
      const roles = await this.getUserRoles(token);
      return { user: token, roles, isGuest: false };
    }

    // 4. Default: Administrator if in development and no headers, or Guest
    const isDev = process.env.NODE_ENV !== 'production';
    if (isDev && process.env.ALLOW_ANONYMOUS_ADMIN !== 'false') {
      return {
        user: 'Administrator',
        roles: ['System Manager', 'All'],
        isGuest: false,
      };
    }

    return {
      user: 'Guest',
      roles: ['Guest', 'All'],
      isGuest: true,
    };
  }

  async validateApiKey(apiKey: string, apiSecret: string): Promise<string | null> {
    const knex = this.db.getKnex();
    const hasUserTable = await knex.schema.hasTable('tabUser');
    if (!hasUserTable) return null;

    const row = await this.db.table('tabUser')
      .where({ api_key: apiKey, api_secret: apiSecret, enabled: 1 })
      .first();

    return row ? row.name : null;
  }

  async getUserRoles(user: string): Promise<string[]> {
    if (user === 'Administrator') {
      return ['System Manager', 'All'];
    }

    const knex = this.db.getKnex();
    const hasRoleTable = await knex.schema.hasTable('tabUserRole');
    if (!hasRoleTable) {
      return ['All'];
    }

    const rolesRows = await this.db.table('tabUserRole')
      .where({ parent: user })
      .select('role');

    const roles = rolesRows.map((r) => r.role);
    if (!roles.includes('All')) {
      roles.push('All');
    }

    return roles;
  }
}
