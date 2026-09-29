import { z } from 'zod';

export const configSchema = z.object({
  port: z.coerce.number().default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  database: z.object({
    client: z.enum(['sqlite3', 'mysql2', 'pg']).default('sqlite3'),
    filename: z.string().default(':memory:'),
    host: z.string().default('127.0.0.1'),
    port: z.coerce.number().default(3306),
    user: z.string().default('root'),
    password: z.string().default(''),
    database: z.string().default('frappe_db'),
  }),
  redis: z.object({
    enabled: z.coerce.boolean().default(false),
    host: z.string().default('127.0.0.1'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export const configuration = (): AppConfig => {
  return configSchema.parse({
    port: process.env.PORT,
    nodeEnv: process.env.NODE_ENV,
    database: {
      client: process.env.DB_CLIENT || 'sqlite3',
      filename: process.env.DB_FILENAME || './sites/current/site.db',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    },
    redis: {
      enabled: process.env.REDIS_ENABLED === 'true',
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
      password: process.env.REDIS_PASSWORD || undefined,
    },
  });
};
