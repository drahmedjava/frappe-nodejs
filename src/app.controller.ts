import { Controller, Get } from '@nestjs/common';
import { DatabaseService } from './database/database.service';
import { RedisService } from './redis/redis.service';

@Controller('api')
export class AppController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  @Get('method/ping')
  ping() {
    return { message: 'pong' };
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
