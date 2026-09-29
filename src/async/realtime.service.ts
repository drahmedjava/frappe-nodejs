import { Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { Server as SocketIOServer } from 'socket.io';
import { Server as HttpServer } from 'http';
import { RealtimeMessageOptions } from './types';
import { DocumentEventsService } from '../document/document-events.service';
import { SiteContextService } from '../tenant/site-context.service';

@Injectable()
export class RealtimeService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);
  private io: SocketIOServer | null = null;

  constructor(
    private readonly docEvents: DocumentEventsService,
    @Optional() private readonly siteContext?: SiteContextService,
  ) {}

  onModuleInit() {
    // Automatically forward document events to real-time clients
    this.docEvents.on('doc:after_save', (payload) => {
      this.publishRealtime('doc_update', {
        doctype: payload.doctype,
        name: payload.name,
        action: 'save',
      }, { doctype: payload.doctype, docname: payload.name });
    });

    this.docEvents.on('doc:after_delete', (payload) => {
      this.publishRealtime('doc_delete', {
        doctype: payload.doctype,
        name: payload.name,
        action: 'delete',
      }, { doctype: payload.doctype, docname: payload.name });
    });
  }

  attach(server: HttpServer): void {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: '*',
      },
    });

    this.io.on('connection', (socket) => {
      this.logger.log(`Socket.IO client connected: ${socket.id}`);

      // Client joins room for specific DocType or Document
      socket.on('subscribe_doctype', (doctype: string) => {
        socket.join(`doctype:${doctype}`);
      });

      socket.on('subscribe_doc', (data: { doctype: string; docname: string }) => {
        socket.join(`doc:${data.doctype}:${data.docname}`);
      });

      socket.on('subscribe_user', (user: string) => {
        socket.join(`user:${user}`);
      });

      socket.on('subscribe_site', (site: string) => {
        socket.join(`site:${site}`);
      });
    });

    this.logger.log('Socket.IO real-time server attached');
  }

  getServer(): SocketIOServer | null {
    return this.io;
  }

  /**
   * Publishes a real-time event via Socket.IO.
   */
  publishRealtime(event: string, message: any, options: RealtimeMessageOptions = {}): void {
    if (!this.io) {
      // In standalone or test mode without HTTP server attached, log and skip
      return;
    }

    const site = this.siteContext?.getCurrentSite();
    const eventPayload = site && typeof message === 'object' && message !== null ? { ...message, site } : message;

    if (site) {
      this.io.to(`site:${site}`).emit(event, eventPayload);
    }

    if (options.room) {
      this.io.to(options.room).emit(event, eventPayload);
    } else if (options.user) {
      this.io.to(`user:${options.user}`).emit(event, eventPayload);
    } else if (options.doctype && options.docname) {
      this.io.to(`doc:${options.doctype}:${options.docname}`).emit(event, eventPayload);
      this.io.to(`doctype:${options.doctype}`).emit(event, eventPayload);
    } else if (options.doctype) {
      this.io.to(`doctype:${options.doctype}`).emit(event, eventPayload);
    } else {
      // Global broadcast
      this.io.emit(event, eventPayload);
    }
  }

  onApplicationShutdown() {
    if (this.io) {
      this.logger.log('Closing Socket.IO server...');
      this.io.close();
      this.io = null;
    }
  }
}
