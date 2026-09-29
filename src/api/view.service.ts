import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocumentService } from '../document/document.service';
import { DatabaseService } from '../database/database.service';

export interface CreateKanbanOptions {
  kanban_board_name: string;
  reference_doctype: string;
  field_name: string;
  columns?: string[];
  filters?: Record<string, any>;
  private?: boolean;
}

export interface CreateCustomViewOptions {
  title: string;
  reference_doctype: string;
  view_type: 'List' | 'Kanban' | 'Calendar' | 'Report' | 'Card';
  filters?: Record<string, any>;
  columns?: string[];
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  settings?: Record<string, any>;
  is_default?: boolean;
  is_private?: boolean;
}

export interface CalendarOptions {
  doctype: string;
  start_field?: string;
  end_field?: string;
  title_field?: string;
  filters?: Record<string, any>;
}

@Injectable()
export class ViewService {
  private readonly logger = new Logger(ViewService.name);

  constructor(
    private readonly metaRegistry: DocTypeRegistryService,
    private readonly docService: DocumentService,
    private readonly db: DatabaseService,
  ) {}

  /**
   * Introspects available views, Select grouping fields, date fields,
   * and existing Kanban boards / custom views for a DocType.
   */
  async getViews(doctype: string): Promise<any> {
    const meta = this.metaRegistry.get(doctype);

    const groupableFields = meta.fields
      .filter((f) => f.fieldtype === 'Select')
      .map((f) => ({
        fieldname: f.fieldname,
        label: f.label,
        options: Array.isArray(f.options)
          ? f.options
          : f.options
          ? String(f.options).split('\n').map((s) => s.trim()).filter(Boolean)
          : [],
      }));

    const dateFields = meta.fields
      .filter((f) => f.fieldtype === 'Date' || f.fieldtype === 'Datetime')
      .map((f) => ({
        fieldname: f.fieldname,
        label: f.label,
        fieldtype: f.fieldtype,
      }));

    const titleField = meta.titleField || (meta.fields.some((f) => f.fieldname === 'title') ? 'title' : 'name');

    const availableViews = ['List', 'Form', 'Report', 'Card'];
    if (groupableFields.length > 0) {
      availableViews.push('Kanban');
    }
    if (dateFields.length > 0) {
      availableViews.push('Calendar', 'Gantt');
    }

    // Query existing Kanban boards
    let kanbanBoards: any[] = [];
    const hasKanbanTable = await this.db.hasTable('tabKanbanBoard');
    if (hasKanbanTable) {
      const rows = await this.docService.getList('KanbanBoard', {
        filters: { reference_doctype: doctype },
      });
      kanbanBoards = rows.map((r) => ({
        ...r,
        columns: typeof r.columns === 'string' ? JSON.parse(r.columns) : r.columns,
        filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : r.filters,
      }));
    }

    // Query existing Custom Views
    let customViews: any[] = [];
    const hasCustomViewTable = await this.db.hasTable('tabCustomView');
    if (hasCustomViewTable) {
      const rows = await this.docService.getList('CustomView', {
        filters: { reference_doctype: doctype },
      });
      customViews = rows.map((r) => ({
        ...r,
        columns: typeof r.columns === 'string' ? JSON.parse(r.columns) : r.columns,
        filters: typeof r.filters === 'string' ? JSON.parse(r.filters) : r.filters,
        settings: typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings,
      }));
    }

    return {
      doctype,
      available_views: availableViews,
      groupable_fields: groupableFields,
      date_fields: dateFields,
      title_field: titleField,
      kanban_boards: kanbanBoards,
      custom_views: customViews,
    };
  }

  /**
   * Creates a new Kanban Board definition for a DocType.
   */
  async createKanbanBoard(options: CreateKanbanOptions): Promise<any> {
    if (!options.kanban_board_name || !options.reference_doctype || !options.field_name) {
      throw new BadRequestException('kanban_board_name, reference_doctype, and field_name are required');
    }

    const meta = this.metaRegistry.get(options.reference_doctype);
    const field = meta.fields.find((f) => f.fieldname === options.field_name);
    if (!field) {
      throw new BadRequestException(`Field "${options.field_name}" does not exist on DocType "${options.reference_doctype}"`);
    }

    // Default columns from Select options if not supplied
    let columns = options.columns;
    if (!columns || columns.length === 0) {
      if (Array.isArray(field.options)) {
        columns = field.options;
      } else if (typeof field.options === 'string') {
        columns = field.options.split('\n').map((s) => s.trim()).filter(Boolean);
      } else {
        columns = ['Default'];
      }
    }

    const board = this.docService.newDoc('KanbanBoard', {
      kanban_board_name: options.kanban_board_name,
      reference_doctype: options.reference_doctype,
      field_name: options.field_name,
      columns: JSON.stringify(columns),
      filters: options.filters ? JSON.stringify(options.filters) : undefined,
      private: options.private ? 1 : 0,
      show_labels: 1,
    });

    await board.insert();
    return board.asJson();
  }

  /**
   * Loads Kanban Board settings and queries documents grouped into columns.
   */
  async getKanbanBoardData(boardName: string, queryFilters: Record<string, any> = {}): Promise<any> {
    const board = await this.docService.getDoc('KanbanBoard', boardName);
    const refDocType = board.get('reference_doctype');
    const fieldName = board.get('field_name');

    let columns: string[] = [];
    const colsRaw = board.get('columns');
    if (typeof colsRaw === 'string') {
      try {
        columns = JSON.parse(colsRaw);
      } catch {
        columns = colsRaw.split(',').map((s) => s.trim());
      }
    } else if (Array.isArray(colsRaw)) {
      columns = colsRaw;
    }

    // Combine board filters with user filters
    let boardFilters: Record<string, any> = {};
    const filtersRaw = board.get('filters');
    if (typeof filtersRaw === 'string') {
      try {
        boardFilters = JSON.parse(filtersRaw);
      } catch {}
    } else if (typeof filtersRaw === 'object' && filtersRaw !== null) {
      boardFilters = filtersRaw;
    }

    const mergedFilters = { ...boardFilters, ...queryFilters };

    // Fetch records
    const records = await this.docService.getList(refDocType, {
      filters: Object.keys(mergedFilters).length > 0 ? mergedFilters : undefined,
      limit: 200,
      orderBy: 'modified desc',
    });

    // Group records by column
    const groupedCards: Record<string, any[]> = {};
    for (const col of columns) {
      groupedCards[col] = [];
    }
    groupedCards['Unassigned'] = [];

    for (const row of records) {
      const colVal = row[fieldName];
      if (colVal !== undefined && colVal !== null && groupedCards[colVal]) {
        groupedCards[colVal].push(row);
      } else {
        groupedCards['Unassigned'].push(row);
      }
    }

    // Omit Unassigned if empty
    if (groupedCards['Unassigned'].length === 0) {
      delete groupedCards['Unassigned'];
    }

    return {
      board: board.asJson(),
      columns,
      grouped_cards: groupedCards,
      total_records: records.length,
    };
  }

  /**
   * Updates card column state when card is dragged across Kanban columns.
   */
  async updateCardColumn(doctype: string, name: string, fieldName: string, newValue: any): Promise<any> {
    const doc = await this.docService.getDoc(doctype, name);
    doc.set(fieldName, newValue);
    await doc.save();
    return { ok: true, doc: doc.asJson() };
  }

  /**
   * Creates a saved CustomView preset.
   */
  async createCustomView(options: CreateCustomViewOptions): Promise<any> {
    if (!options.title || !options.reference_doctype || !options.view_type) {
      throw new BadRequestException('title, reference_doctype, and view_type are required');
    }

    const view = this.docService.newDoc('CustomView', {
      title: options.title,
      reference_doctype: options.reference_doctype,
      view_type: options.view_type,
      filters: options.filters ? JSON.stringify(options.filters) : undefined,
      columns: options.columns ? JSON.stringify(options.columns) : undefined,
      sort_by: options.sort_by,
      sort_order: options.sort_order || 'desc',
      settings: options.settings ? JSON.stringify(options.settings) : undefined,
      is_default: options.is_default ? 1 : 0,
      is_private: options.is_private ? 1 : 0,
    });

    await view.insert();
    return view.asJson();
  }

  /**
   * Queries and returns calendar events for a DocType based on Date/Datetime fields.
   */
  async getCalendarData(doctype: string, options: CalendarOptions = { doctype }): Promise<any> {
    const meta = this.metaRegistry.get(doctype);

    const dateFields = meta.fields.filter((f) => f.fieldtype === 'Date' || f.fieldtype === 'Datetime');
    if (dateFields.length === 0) {
      throw new BadRequestException(`DocType "${doctype}" has no Date or Datetime fields for Calendar view`);
    }

    const startField = options.start_field || dateFields[0].fieldname;
    const endField = options.end_field || (dateFields.length > 1 ? dateFields[1].fieldname : startField);
    const titleField = options.title_field || meta.titleField || (meta.fields.some((f) => f.fieldname === 'title') ? 'title' : 'name');

    const records = await this.docService.getList(doctype, {
      filters: options.filters,
      limit: 300,
    });

    const events = records
      .filter((r) => r[startField])
      .map((r) => ({
        id: r.name,
        title: r[titleField] ? `${r.name}: ${r[titleField]}` : r.name,
        start: r[startField],
        end: r[endField] || r[startField],
        allDay: true,
        doc: r,
      }));

    return {
      events,
      start_field: startField,
      end_field: endField,
      title_field: titleField,
    };
  }
}
