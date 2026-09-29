import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';

interface ScheduledTask {
  name: string;
  intervalMs: number;
  timer: NodeJS.Timeout;
  task: () => Promise<void> | void;
}

@Injectable()
export class SchedulerService implements OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerService.name);
  private tasks = new Map<string, ScheduledTask>();

  registerJob(name: string, intervalMs: number, task: () => Promise<void> | void): void {
    if (this.tasks.has(name)) {
      this.cancelJob(name);
    }

    const timer = setInterval(async () => {
      try {
        await task();
      } catch (err: any) {
        this.logger.error(`Scheduled task [${name}] failed: ${err.message}`);
      }
    }, intervalMs);

    this.tasks.set(name, { name, intervalMs, timer, task });
    this.logger.log(`Registered scheduled job [${name}] (interval: ${intervalMs}ms)`);
  }

  cancelJob(name: string): void {
    const entry = this.tasks.get(name);
    if (entry) {
      clearInterval(entry.timer);
      this.tasks.delete(name);
    }
  }

  async runNow(name: string): Promise<void> {
    const entry = this.tasks.get(name);
    if (entry) {
      await entry.task();
    }
  }

  onApplicationShutdown() {
    this.logger.log('Shutting down scheduler timers...');
    for (const [name, entry] of this.tasks.entries()) {
      clearInterval(entry.timer);
    }
    this.tasks.clear();
  }
}
