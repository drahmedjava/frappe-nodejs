import { Injectable, OnApplicationShutdown, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export interface ICache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  flush(): Promise<void>;
}

class InMemoryCache implements ICache {
  private store = new Map<string, { val: string; expires?: number }>();

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expires && Date.now() > item.expires) {
      this.store.delete(key);
      return null;
    }
    return item.val;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expires = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(key, { val: value, expires });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }
}

@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private fallbackCache: InMemoryCache = new InMemoryCache();
  private isEnabled = false;

  constructor(private configService: ConfigService) {
    const redisConfig = this.configService.get('redis');
    this.isEnabled = !!redisConfig?.enabled;

    if (this.isEnabled) {
      try {
        this.client = new Redis({
          host: redisConfig.host || '127.0.0.1',
          port: redisConfig.port || 6379,
          password: redisConfig.password || undefined,
          lazyConnect: true,
          retryStrategy: (times) => {
            if (times > 3) {
              this.logger.warn('Redis connection retry limit reached. Falling back to in-memory cache.');
              return null;
            }
            return Math.min(times * 100, 2000);
          },
        });

        this.client.connect().catch((err) => {
          this.logger.warn(`Could not connect to Redis (${err.message}). Using in-memory cache.`);
          this.client = null;
        });

        this.logger.log(`Redis initialized at ${redisConfig.host}:${redisConfig.port}`);
      } catch (err: any) {
        this.logger.warn(`Redis initialization failed (${err?.message}). Using in-memory cache.`);
        this.client = null;
      }
    } else {
      this.logger.log('Redis is disabled; using in-memory cache provider.');
    }
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (this.client) {
      return this.client.get(key);
    }
    return this.fallbackCache.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.client) {
      if (ttlSeconds) {
        await this.client.set(key, value, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, value);
      }
      return;
    }
    await this.fallbackCache.set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    if (this.client) {
      await this.client.del(key);
      return;
    }
    await this.fallbackCache.del(key);
  }

  async ping(): Promise<boolean> {
    if (this.client) {
      try {
        const res = await this.client.ping();
        return res === 'PONG';
      } catch {
        return false;
      }
    }
    return true; // in-memory is always healthy
  }

  async onApplicationShutdown() {
    if (this.client) {
      this.logger.log('Disconnecting Redis client...');
      await this.client.quit().catch(() => {});
    }
  }
}
