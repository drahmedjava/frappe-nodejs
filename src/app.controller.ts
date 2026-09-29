import { Controller, Get, Post, Query } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { RedisService } from './redis/redis.service';
import { SchemaSyncService } from './meta/schema-sync.service';
import { DocTypeRegistryService } from './meta/doctype-registry.service';

@Controller('api')
export class AppController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly syncService: SchemaSyncService,
    private readonly metaRegistry: DocTypeRegistryService,
  ) {}

  @Get('method/ping')
  ping() {
    return { message: 'pong' };
  }

  @Get('method/frappe.get_meta')
  getMeta(@Query('doctype') doctype: string) {
    if (!doctype) {
      return { error: 'doctype query parameter is required' };
    }
    return { message: this.metaRegistry.get(doctype) };
  }

  @Post('method/frappe.migrate')
  async migrate() {
    await this.syncService.syncAll();

    const knex = this.db.getKnex();
    const hasUserTable = await knex.schema.hasTable('tabUser');
    if (hasUserTable) {
      const adminExists = await knex('tabUser').where({ email: 'Administrator' }).orWhere({ name: 'Administrator' }).first();
      if (!adminExists) {
        const now = new Date().toISOString();
        await knex('tabUser').insert({
          name: 'Administrator',
          email: 'Administrator',
          first_name: 'Administrator',
          enabled: 1,
          creation: now,
          modified: now,
          modified_by: 'Administrator',
          owner: 'Administrator',
          docstatus: 0,
          idx: 0,
        });

        const hasRoleTable = await knex.schema.hasTable('tabUserRole');
        if (hasRoleTable) {
          await knex('tabUserRole').insert([
            {
              name: Math.random().toString(36).substring(2, 12),
              creation: now,
              modified: now,
              modified_by: 'Administrator',
              owner: 'Administrator',
              docstatus: 0,
              idx: 1,
              parent: 'Administrator',
              parenttype: 'User',
              parentfield: 'roles',
              role: 'System Manager',
            },
            {
              name: Math.random().toString(36).substring(2, 12),
              creation: now,
              modified: now,
              modified_by: 'Administrator',
              owner: 'Administrator',
              docstatus: 0,
              idx: 2,
              parent: 'Administrator',
              parenttype: 'User',
              parentfield: 'roles',
              role: 'All',
            },
          ]);
        }
      }
    }

    return { message: 'Migration completed successfully' };
  }

  @Get('health')
  async health() {
    const dbOk = await this.db.ping();
    const redisOk = await this.redis.ping();

    return {
      status: dbOk && redisOk ? 'ok' : 'degraded',
      services: {
        database: dbOk ? 'healthy' : 'unhealthy',
        redis: redisOk ? 'healthy' : 'unhealthy',
      },
      timestamp: new Date().toISOString(),
    };
  }
}
