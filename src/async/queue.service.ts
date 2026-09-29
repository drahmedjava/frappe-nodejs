import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { JobHandler, JobPayload } from './types';
import { Queue, Worker } from 'bullmq';
import * as crypto from 'crypto';

@Injectable()
export class QueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(QueueService.name);
  private handlers = new Map<string, JobHandler>();
  private bullQueue: Queue | null = null;
  private bullWorker: Worker | null = null;
  private inMemoryQueue: JobPayload[] = [];
  private isProcessingInMemory = false;

  constructor(private readonly redisService: RedisService) {
    const redisClient = this.redisService.getClient();

    if (redisClient) {
      try {
        const connection = {
          host: redisClient.options.host || '127.0.0.1',
          port: redisClient.options.port || 6379,
          password: redisClient.options.password || undefined,
        };

        this.bullQueue = new Queue('frappe-jobs', { connection });
        this.bullWorker = new Worker(
          'frappe-jobs',
          async (job) => {
            const handler = this.handlers.get(job.name);
            if (handler) {
              return await handler(job.data);
            } else {
              this.logger.warn(`No handler registered for background job: ${job.name}`);
            }
          },
          { connection },
        );

        this.logger.log('BullMQ initialized with Redis connection');
      } catch (err: any) {
        this.logger.warn(`BullMQ initialization failed (${err.message}). Using in-memory job queue.`);
        this.bullQueue = null;
        this.bullWorker = null;
      }
    } else {
      this.logger.log('Redis client not available; using in-memory job queue provider.');
    }
  }

  registerWorker(jobName: string, handler: JobHandler): void {
    this.handlers.set(jobName, handler);
    this.logger.log(`Registered background worker for [${jobName}]`);
  }

  async enqueue(jobName: string, data: any, options?: { delay?: number }): Promise<string> {
    const jobId = crypto.randomUUID();

    if (this.bullQueue) {
      const bullJob = await this.bullQueue.add(jobName, data, {
        jobId,
        delay: options?.delay,
      });
      return bullJob.id || jobId;
    }

    // In-memory queue fallback
    const job: JobPayload = {
      id: jobId,
      name: jobName,
      data,
      timestamp: Date.now(),
    };

    if (options?.delay && options.delay > 0) {
      setTimeout(() => {
        this.inMemoryQueue.push(job);
        this.processInMemory();
      }, options.delay);
    } else {
      this.inMemoryQueue.push(job);
      // Run on next tick
      setImmediate(() => this.processInMemory());
    }

    return jobId;
  }

  private async processInMemory(): Promise<void> {
    if (this.isProcessingInMemory) return;
    this.isProcessingInMemory = true;

    while (this.inMemoryQueue.length > 0) {
      const job = this.inMemoryQueue.shift();
      if (!job) break;

      const handler = this.handlers.get(job.name);
      if (handler) {
        try {
          await handler(job.data);
        } catch (err: any) {
          this.logger.error(`Job [${job.name}] failed: ${err.message}`, err.stack);
        }
      } else {
        this.logger.warn(`No handler registered for in-memory job: ${job.name}`);
      }
    }

    this.isProcessingInMemory = false;
  }

  async onApplicationShutdown() {
    if (this.bullWorker) {
      await this.bullWorker.close();
    }
    if (this.bullQueue) {
      await this.bullQueue.close();
    }
  }
}
