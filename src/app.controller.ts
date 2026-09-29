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
