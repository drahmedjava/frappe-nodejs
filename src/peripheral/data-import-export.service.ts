import { Injectable, Logger } from '@nestjs/common';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { DocumentService } from '../document/document.service';
import { GetListOptions } from '../document/types';

export interface ImportResult {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ row: number; docname?: string; message: string }>;
}

export interface ExportResult {
  data: string;
  mimeType: string;
  filename: string;
}

@Injectable()
export class DataImportExportService {
  private readonly logger = new Logger(DataImportExportService.name);

  constructor(
    private readonly registry: DocTypeRegistryService,
    private readonly docService: DocumentService,
  ) {}

  /**
   * Exports documents of a DocType as JSON or CSV.
   */
  async exportData(
    doctype: string,
    format: 'json' | 'csv' = 'json',
    options: GetListOptions = {},
  ): Promise<ExportResult> {
    const meta = this.registry.get(doctype);
    const list = await this.docService.getList(doctype, options);

    // Load full documents including child tables
    const fullDocs = await Promise.all(
      list.map(async (item) => {
        try {
          const doc = await this.docService.getDoc(doctype, item.name);
          return doc.asJson();
        } catch {
          return item;
        }
      }),
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (format === 'json') {
      return {
        data: JSON.stringify(fullDocs, null, 2),
        mimeType: 'application/json',
        filename: `${doctype}_export_${timestamp}.json`,
      };
    }

    // CSV format
    const standardFields = ['name', 'docstatus', 'owner', 'creation', 'modified'];
    const docFields = meta.fields.filter((f) => f.fieldtype !== 'Table').map((f) => f.fieldname);
    const columns = Array.from(new Set([...standardFields, ...docFields]));

    const headerLine = columns.map(this.escapeCsvCell).join(',');
    const dataLines = fullDocs.map((doc) => {
      return columns
        .map((col) => {
          const val = doc[col];
          return this.escapeCsvCell(val);
        })
        .join(',');
    });

    const csvContent = [headerLine, ...dataLines].join('\n');
    return {
      data: csvContent,
      mimeType: 'text/csv',
      filename: `${doctype}_export_${timestamp}.csv`,
    };
  }

  /**
   * Imports documents from JSON or CSV into the database.
   */
  async importData(
    doctype: string,
    content: string | any[],
    format: 'json' | 'csv' = 'json',
    user = 'Administrator',
  ): Promise<ImportResult> {
    const meta = this.registry.get(doctype);
    let records: Record<string, any>[] = [];

    if (Array.isArray(content)) {
      records = content;
    } else if (format === 'json') {
      records = JSON.parse(content);
      if (!Array.isArray(records)) {
        throw new Error('Import data must be a JSON array of documents');
      }
    } else if (format === 'csv') {
      records = this.parseCsv(content);
    }

    const result: ImportResult = {
      total: records.length,
      success: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      try {
        let doc: any;
        let isExisting = false;

        if (record.name) {
          try {
            doc = await this.docService.getDoc(doctype, record.name);
            isExisting = true;
          } catch {
            isExisting = false;
          }
        }

        if (isExisting && doc) {
          // Update existing doc
          for (const [k, v] of Object.entries(record)) {
            if (!['name', 'creation', 'owner'].includes(k)) {
              doc.set(k, v);
            }
          }
          await doc.save(user);
        } else {
          // Insert new doc
          doc = this.docService.newDoc(doctype, record);
          await doc.insert(user);
        }

        result.success++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: i + 1,
          docname: record?.name,
          message: err.message,
        });
      }
    }

    return result;
  }

  /**
   * RFC 4180 compliant CSV cell escaper.
   */
  private escapeCsvCell(val: any): string {
    if (val === undefined || val === null) return '';
    const str = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }

  /**
   * RFC 4180 compliant CSV parser.
   */
  public parseCsv(csvText: string): Record<string, any>[] {
    const lines = this.tokenizeCsv(csvText);
    if (lines.length < 2) return [];

    const headers = lines[0].map((h) => h.trim());
    const records: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const row = lines[i];
      if (row.length === 1 && row[0].trim() === '') continue; // skip blank lines
      const record: Record<string, any> = {};

      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (!header) continue;
        const rawVal = row[j] ?? '';
        record[header] = this.coerceCsvValue(rawVal);
      }

      records.push(record);
    }

    return records;
  }

  /**
   * Splits CSV text into tokens accounting for quotes and multiline cells.
   */
  private tokenizeCsv(text: string): string[][] {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let insideQuotes = false;

    let i = 0;
    while (i < text.length) {
      const char = text[i];
      const nextChar = text[i + 1];

      if (insideQuotes) {
        if (char === '"') {
          if (nextChar === '"') {
            // Escaped quote
            currentCell += '"';
            i += 2;
            continue;
          } else {
            // End of quoted block
            insideQuotes = false;
            i++;
            continue;
          }
        } else {
          currentCell += char;
          i++;
          continue;
        }
      } else {
        if (char === '"') {
          insideQuotes = true;
          i++;
          continue;
        } else if (char === ',') {
          currentRow.push(currentCell);
          currentCell = '';
          i++;
          continue;
        } else if (char === '\r') {
          if (nextChar === '\n') {
            i++;
          }
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
          i++;
          continue;
        } else if (char === '\n') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
          i++;
          continue;
        } else {
          currentCell += char;
          i++;
          continue;
        }
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * Helper to parse string values like numbers, booleans, and JSON child tables.
   */
  private coerceCsvValue(val: string): any {
    const trimmed = val.trim();
    if (trimmed === '') return '';

    // Check JSON arrays or objects
    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // keep as string
      }
    }

    // Number check
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (!isNaN(n)) return n;
    }

    // Boolean check
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;

    return val;
  }
}
