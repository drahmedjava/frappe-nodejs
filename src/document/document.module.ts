import { Global, Module, OnModuleInit } from '@nestjs/common';
import { NamingService } from './naming.service';
import { DocumentEventsService } from './document-events.service';
import { DocumentControllerRegistry } from './document-controller.registry';
import { DocumentService } from './document.service';
import { TaskDocument } from './controllers/task.document';

@Global()
@Module({
  providers: [
    NamingService,
    DocumentEventsService,
    DocumentControllerRegistry,
    DocumentService,
  ],
  exports: [
    NamingService,
    DocumentEventsService,
    DocumentControllerRegistry,
    DocumentService,
  ],
})
export class DocumentModule implements OnModuleInit {
  constructor(private readonly controllerRegistry: DocumentControllerRegistry) {}

  onModuleInit() {
    // Register built-in document controllers
    this.controllerRegistry.register('Task', TaskDocument);
  }
}
