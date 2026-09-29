import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { configuration } from '../src/config/configuration';
import { DatabaseModule } from '../src/database/database.module';
import { DatabaseService } from '../src/database/database.service';
import { RedisModule } from '../src/redis/redis.module';
import { RedisService } from '../src/redis/redis.service';
import { AppController } from '../src/app.controller';

describe('Phase 0 Foundation Tests', () => {
  let moduleRef: TestingModule;
  let dbService: DatabaseService;
  let redisService: RedisService;
  let appController: AppController;

  beforeAll(async () => {
    // Override environment for test (sqlite in-memory, redis disabled)
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
        }),
        DatabaseModule,
        RedisModule,
      ],
      controllers: [AppController],
    }).compile();

    dbService = moduleRef.get<DatabaseService>(DatabaseService);
    redisService = moduleRef.get<RedisService>(RedisService);
    appController = moduleRef.get<AppController>(AppController);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('DatabaseService (Knex)', () => {
    it('should ping database successfully', async () => {
      const isAlive = await dbService.ping();
      expect(isAlive).toBe(true);
    });

    it('should execute raw SQL queries', async () => {
      const result = await dbService.sql('SELECT 1 + 1 as total');
      expect(result).toBeDefined();
      expect(result.length).toBe(1);
      expect(result[0].total).toBe(2);
    });

    it('should create a table and query it using Knex', async () => {
      const knex = dbService.getKnex();
      await knex.schema.createTable('test_table', (table) => {
        table.string('id').primary();
        table.string('name');
      });

      const exists = await dbService.hasTable('test_table');
      expect(exists).toBe(true);

      await dbService.table('test_table').insert({ id: 'doc-1', name: 'Test Doc' });
      const rows = await dbService.table('test_table').select('*');
      expect(rows.length).toBe(1);
      expect(rows[0]).toEqual({ id: 'doc-1', name: 'Test Doc' });
    });

    it('should support transactions', async () => {
      await dbService.transaction(async (trx) => {
        await trx('test_table').insert({ id: 'doc-2', name: 'Transactional Doc' });
      });

      const row = await dbService.table('test_table').where({ id: 'doc-2' }).first();
      expect(row).toBeDefined();
      expect(row.name).toBe('Transactional Doc');
    });
  });

  describe('RedisService (Cache Fallback & Operations)', () => {
    it('should ping cache provider', async () => {
      const isAlive = await redisService.ping();
      expect(isAlive).toBe(true);
    });

    it('should set and get values with TTL', async () => {
      await redisService.set('foo', 'bar');
      const val = await redisService.get('foo');
      expect(val).toBe('bar');

      await redisService.del('foo');
      const deletedVal = await redisService.get('foo');
      expect(deletedVal).toBeNull();
    });
  });

  describe('AppController', () => {
    it('should respond to ping method', () => {
      expect(appController.ping()).toEqual({ message: 'pong' });
    });

    it('should report healthy status', async () => {
      const health = await appController.health();
      expect(health.status).toBe('ok');
      expect(health.services.database).toBe('healthy');
      expect(health.services.redis).toBe('healthy');
    });
  });
});
