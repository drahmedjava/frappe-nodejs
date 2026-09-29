import { Injectable, Logger, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { SchemaSyncService } from '../meta/schema-sync.service';
import { ViewService } from '../api/view.service';
import { DocumentService } from '../document/document.service';
import { DatabaseService } from '../database/database.service';
import { DocumentControllerRegistry } from '../document/document-controller.registry';
import { DocType } from '../meta/types';

export interface KanbanBoardConfig {
  name: string;
  referenceDoctype: string;
  fieldName: string;
  columns?: string[];
  filters?: Record<string, any>;
  cardTemplate?: string;
  private?: boolean;
}

export interface CustomViewConfig {
  title: string;
  referenceDoctype: string;
  viewType: 'List' | 'Kanban' | 'Calendar' | 'Report' | 'Card';
  filters?: Record<string, any>;
  columns?: string[];
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  settings?: Record<string, any>;
  cardTemplate?: string;
  rowTemplate?: string;
}

export interface CustomHtmlBlockConfig {
  name: string;
  referenceDoctype?: string;
  html: string;
  style?: string;
  script?: string;
}

export interface FeatureViewsConfig {
  kanbanBoards?: KanbanBoardConfig[];
  customViews?: CustomViewConfig[];
  htmlBlocks?: CustomHtmlBlockConfig[];
  printFormats?: Array<{
    name: string;
    referenceDoctype: string;
    html: string;
    isDefault?: boolean;
  }>;
}

export interface FrappeFeatureOptions {
  moduleName?: string;
  doctypesPath?: string;
  doctypes?: DocType[];
  documentController?: {
    doctype: string;
    controllerClass: any;
  };
  views?: FeatureViewsConfig;
  syncSchema?: boolean;
}

@Injectable()
export class FrappeFeatureService {
  private readonly logger = new Logger(FrappeFeatureService.name);

  constructor(
    private readonly metaRegistry: DocTypeRegistryService,
    private readonly schemaSync: SchemaSyncService,
    private readonly db: DatabaseService,
    private readonly docService: DocumentService,
    private readonly docControllerRegistry: DocumentControllerRegistry,
    @Optional() private readonly viewService?: ViewService,
  ) {}

  /**
   * Registers a self-contained feature module:
   * 1. Loads and registers DocTypes (schemas & child tables)
   * 2. Synchronizes database tables (DDL)
   * 3. Registers Document controller class if provided
   * 4. Seeds pre-configured views (Kanban boards, Custom views, HTML blocks)
   */
  async registerFeature(options: FrappeFeatureOptions): Promise<void> {
    const registeredDocTypes: DocType[] = [];

    // 1. Register DocTypes from directory if path provided
    if (options.doctypesPath && fs.existsSync(options.doctypesPath)) {
      const files = fs.readdirSync(options.doctypesPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(options.doctypesPath, file);
          try {
            const raw = fs.readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw) as DocType;
            if (options.moduleName && !parsed.module) {
              parsed.module = options.moduleName;
            }
            this.metaRegistry.register(parsed);
            registeredDocTypes.push(this.metaRegistry.get(parsed.name));
          } catch (err: any) {
            this.logger.error(`Failed to load DocType from ${filePath}: ${err.message}`);
          }
        }
      }
    }

    // 2. Register explicit DocType objects if provided
    if (options.doctypes && options.doctypes.length > 0) {
      for (const dt of options.doctypes) {
        if (options.moduleName && !dt.module) {
          dt.module = options.moduleName;
        }
        this.metaRegistry.register(dt);
        registeredDocTypes.push(this.metaRegistry.get(dt.name));
      }
    }

    // 3. Synchronize database schema for registered DocTypes
    if (options.syncSchema !== false) {
      for (const dt of registeredDocTypes) {
        try {
          await this.schemaSync.syncDocType(dt);
        } catch (err: any) {
          this.logger.warn(`Could not sync schema for DocType [${dt.name}]: ${err.message}`);
        }
      }
    }

    // 4. Register Document controller if provided
    if (options.documentController) {
      this.docControllerRegistry.register(
        options.documentController.doctype,
        options.documentController.controllerClass,
      );
    }

    // 5. Seed initial Views, Kanban Boards, and HTML Blocks
    if (options.views) {
      await this.initViews(options.views);
    }
  }

  private async initViews(views: FeatureViewsConfig): Promise<void> {
    if (!this.viewService) return;

    // A. Kanban Boards
    if (views.kanbanBoards && views.kanbanBoards.length > 0) {
      if (this.metaRegistry.has('KanbanBoard')) {
        await this.schemaSync.syncDocType(this.metaRegistry.get('KanbanBoard'));
      }
      const hasKanbanTable = await this.db.hasTable('tabKanbanBoard');
      if (hasKanbanTable) {
        for (const board of views.kanbanBoards) {
          try {
            const exists = await this.docService.getList('KanbanBoard', {
              filters: { kanban_board_name: board.name },
              limit: 1,
            });
            if (exists.length === 0) {
              await this.viewService.createKanbanBoard({
                kanban_board_name: board.name,
                reference_doctype: board.referenceDoctype,
                field_name: board.fieldName,
                columns: board.columns,
                filters: board.filters,
                card_template: board.cardTemplate,
                private: board.private,
              });
              this.logger.log(`Initialized feature Kanban board: [${board.name}]`);
            }
          } catch (err: any) {
            this.logger.warn(`Failed initializing Kanban board [${board.name}]: ${err.message}`);
          }
        }
      }
    }

    // B. Custom Views
    if (views.customViews && views.customViews.length > 0) {
      if (this.metaRegistry.has('CustomView')) {
        await this.schemaSync.syncDocType(this.metaRegistry.get('CustomView'));
      }
      const hasCustomViewTable = await this.db.hasTable('tabCustomView');
      if (hasCustomViewTable) {
        for (const cv of views.customViews) {
          try {
            const exists = await this.docService.getList('CustomView', {
              filters: { title: cv.title, reference_doctype: cv.referenceDoctype },
              limit: 1,
            });
            if (exists.length === 0) {
              await this.viewService.createCustomView({
                title: cv.title,
                reference_doctype: cv.referenceDoctype,
                view_type: cv.viewType,
                filters: cv.filters,
                columns: cv.columns,
                sort_by: cv.sort_by,
                sort_order: cv.sort_order,
                settings: cv.settings,
                card_template: cv.cardTemplate,
                row_template: cv.rowTemplate,
              });
              this.logger.log(`Initialized feature CustomView: [${cv.title}]`);
            }
          } catch (err: any) {
            this.logger.warn(`Failed initializing CustomView [${cv.title}]: ${err.message}`);
          }
        }
      }
    }

    // C. Custom HTML Blocks
    if (views.htmlBlocks && views.htmlBlocks.length > 0) {
      if (this.metaRegistry.has('CustomHTMLBlock')) {
        await this.schemaSync.syncDocType(this.metaRegistry.get('CustomHTMLBlock'));
      }
      const hasHtmlBlockTable = await this.db.hasTable('tabCustomHTMLBlock');
      if (hasHtmlBlockTable) {
        for (const block of views.htmlBlocks) {
          try {
            const exists = await this.docService.getList('CustomHTMLBlock', {
              filters: { block_name: block.name },
              limit: 1,
            });
            if (exists.length === 0) {
              const doc = this.docService.newDoc('CustomHTMLBlock', {
                block_name: block.name,
                reference_doctype: block.referenceDoctype,
                html: block.html,
                style: block.style,
                script: block.script,
                is_active: 1,
              });
              await doc.insert();
              this.logger.log(`Initialized feature CustomHTMLBlock: [${block.name}]`);
            }
          } catch (err: any) {
            this.logger.warn(`Failed initializing CustomHTMLBlock [${block.name}]: ${err.message}`);
          }
        }
      }
    }
  }
}
