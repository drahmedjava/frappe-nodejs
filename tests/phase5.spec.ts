import 'reflect-metadata';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { io as ClientSocket, Socket as ClientSocketType } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { QueueService } from '../src/async/queue.service';
import { SchedulerService } from '../src/async/scheduler.service';
import { RealtimeService } from '../src/async/realtime.service';
import { DocumentService } from '../src/document/document.service';
import { SchemaSyncService } from '../src/meta/schema-sync.service';

describe('Phase 5 Background & Real-Time Tests', () => {
  let app: INestApplication;
  let queueService: QueueService;
  let schedulerService: SchedulerService;
  let realtimeService: RealtimeService;
  let docService: DocumentService;
  let syncService: SchemaSyncService;
  let clientSocket: ClientSocketType;
  let port: number;

  beforeAll(async () => {
    process.env.DB_CLIENT = 'sqlite3';
    process.env.DB_FILENAME = ':memory:';
    process.env.REDIS_ENABLED = 'false';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    queueService = moduleRef.get<QueueService>(QueueService);
    schedulerService = moduleRef.get<SchedulerService>(SchedulerService);
    realtimeService = moduleRef.get<RealtimeService>(RealtimeService);
    docService = moduleRef.get<DocumentService>(DocumentService);
    syncService = moduleRef.get<SchemaSyncService>(SchemaSyncService);

    await syncService.syncAll();

    // Start ephemeral server for WebSocket testing
    const server = await app.listen(0);
    port = (server.address() as any).port;
    realtimeService.attach(app.getHttpServer());

    // Connect real-time test client
    clientSocket = ClientSocket(`http://localhost:${port}`, {
      transports: ['websocket'],
    });

    await new Promise<void>((resolve) => {
      clientSocket.on('connect', () => resolve());
    });
  });

  afterAll(async () => {
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    await app.close();
  });

  describe('QueueService (Background Jobs)', () => {
    it('should process enqueued background jobs', async () => {
      let jobExecuted = false;
      let receivedData: any = null;

      queueService.registerWorker('send_notification', async (data) => {
        jobExecuted = true;
        receivedData = data;
      });

      const jobId = await queueService.enqueue('send_notification', {
        title: 'Task Due',
        recipient: 'john@example.com',
      });

      expect(jobId).toBeDefined();

      // Wait a tick for async execution
      await new Promise((r) => setTimeout(r, 100));

      expect(jobExecuted).toBe(true);
      expect(receivedData).toEqual({
        title: 'Task Due',
        recipient: 'john@example.com',
      });
    });

    it('should handle delayed background jobs', async () => {
      let delayedExecuted = false;

      queueService.registerWorker('delayed_action', async () => {
        delayedExecuted = true;
      });

      await queueService.enqueue('delayed_action', {}, { delay: 100 });
      expect(delayedExecuted).toBe(false);

      await new Promise((r) => setTimeout(r, 150));
      expect(delayedExecuted).toBe(true);
    });
  });

  describe('SchedulerService (Cron / Periodic Tasks)', () => {
    it('should register and execute scheduled jobs', async () => {
      let runCount = 0;

      schedulerService.registerJob('counter_tick', 50, () => {
        runCount++;
      });

      await new Promise((r) => setTimeout(r, 130));
      expect(runCount).toBeGreaterThanOrEqual(2);

      schedulerService.cancelJob('counter_tick');
      const countAfterCancel = runCount;

      await new Promise((r) => setTimeout(r, 100));
      expect(runCount).toBe(countAfterCancel);
    });
  });

  describe('RealtimeService (Socket.IO Live Updates)', () => {
    it('should receive real-time doc_update event when document is created/saved', async () => {
      // Subscribe to Task room
      clientSocket.emit('subscribe_doctype', 'Task');
      await new Promise((r) => setTimeout(r, 50));

      const eventPromise = new Promise<any>((resolve) => {
        clientSocket.once('doc_update', (msg) => {
          resolve(msg);
        });
      });

      // Insert Task
      const task = docService.newDoc('Task', {
        title: 'Real-time Test Task',
      });
      await task.insert();

      const receivedMsg = await eventPromise;
      expect(receivedMsg.doctype).toBe('Task');
      expect(receivedMsg.name).toBe(task.name);
      expect(receivedMsg.action).toBe('save');
    });

    it('should receive real-time doc_delete event when document is deleted', async () => {
      const task = docService.newDoc('Task', {
        title: 'Task to Delete',
      });
      await task.insert();

      const deletePromise = new Promise<any>((resolve) => {
        clientSocket.once('doc_delete', (msg) => {
          resolve(msg);
        });
      });

      await task.delete();

      const receivedMsg = await deletePromise;
      expect(receivedMsg.doctype).toBe('Task');
      expect(receivedMsg.name).toBe(task.name);
      expect(receivedMsg.action).toBe('delete');
    });
  });
});
