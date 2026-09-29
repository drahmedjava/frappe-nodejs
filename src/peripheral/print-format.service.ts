import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { DocTypeRegistryService } from '../meta/doctype-registry.service';
import { BaseDocument } from '../document/base-document';

@Injectable()
export class PrintFormatService {
  private readonly logger = new Logger(PrintFormatService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly registry: DocTypeRegistryService,
  ) {}

  /**
   * Renders a document into printable HTML using a custom PrintFormat or Standard format.
   */
  async render(doc: BaseDocument, formatName?: string): Promise<string> {
    if (formatName && formatName !== 'Standard') {
      const customHtml = await this.renderCustomFormat(doc, formatName);
      if (customHtml) {
        return customHtml;
      }
    }

    return this.renderStandardFormat(doc);
  }

  /**
   * Renders a document using a custom PrintFormat from tabPrintFormat.
   */
  private async renderCustomFormat(doc: BaseDocument, formatName: string): Promise<string | null> {
    const hasTable = await this.db.hasTable('tabPrintFormat');
    if (!hasTable) return null;

    const pfRow = await this.db
      .table('tabPrintFormat')
      .where({ doc_type: doc.doctype })
      .andWhere((builder) => {
        builder.where({ name: formatName }).orWhere({ name_format: formatName });
      })
      .first();

    if (!pfRow || !pfRow.html) return null;

    let rendered = pfRow.html;

    // Handle {{#each table_fieldname}} ... {{/each}} blocks
    const eachRegex = /\{\{#each\s+([\w_]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;
    rendered = rendered.replace(eachRegex, (_: string, tableField: string, innerTemplate: string) => {
      const rows = doc.get(tableField);
      if (!Array.isArray(rows) || rows.length === 0) {
        return '';
      }
      return rows
        .map((row) => {
          let rowHtml = innerTemplate;
          for (const [key, value] of Object.entries(row)) {
            const valStr = value !== undefined && value !== null ? String(value) : '';
            rowHtml = rowHtml.replace(new RegExp(`\\{\\{\\s*(this\\.)?${key}\\s*\\}\\}`, 'g'), valStr);
          }
          return rowHtml;
        })
        .join('');
    });

    // Replace {{ doc.fieldname }} and {{ fieldname }}
    for (const [key, value] of Object.entries(doc.data)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) continue;
      const valStr = value !== undefined && value !== null && !Array.isArray(value) ? String(value) : '';
      rendered = rendered.replace(new RegExp(`\\{\\{\\s*doc\\.${key}\\s*\\}\\}`, 'g'), valStr);
      rendered = rendered.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), valStr);
    }

    // Replace {{ meta.name }}
    rendered = rendered.replace(/\{\{\s*meta\.name\s*\}\}/g, doc.doctype);

    const customCss = pfRow.css ? `<style>${pfRow.css}</style>` : '';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${doc.doctype} - ${doc.name}</title>
  ${customCss}
</head>
<body class="print-format-custom">
  ${rendered}
</body>
</html>`;
  }

  /**
   * Generates a clean, professional standard Frappe printable layout.
   */
  private renderStandardFormat(doc: BaseDocument): string {
    const meta = doc.meta;
    const docstatus = doc.docstatus;
    let badgeClass = 'badge-draft';
    let badgeText = 'Draft';
    if (docstatus === 1) {
      badgeClass = 'badge-submitted';
      badgeText = 'Submitted';
    } else if (docstatus === 2) {
      badgeClass = 'badge-cancelled';
      badgeText = 'Cancelled';
    }

    // Render field rows
    const nonTableFields = meta.fields.filter(
      (f) => f.fieldtype !== 'Table' && !f.hidden && f.fieldtype !== 'Password',
    );

    const fieldsHtml = nonTableFields
      .map((f) => {
        const val = doc.get(f.fieldname);
        const displayVal = val !== undefined && val !== null ? String(val) : '—';
        return `
          <div class="field-row">
            <span class="field-label">${f.label}:</span>
            <span class="field-value">${displayVal}</span>
          </div>`;
      })
      .join('\n');

    // Render child tables
    const tableFields = meta.fields.filter((f) => f.fieldtype === 'Table');
    let tablesHtml = '';

    for (const tf of tableFields) {
      const childRows = doc.get(tf.fieldname) || [];
      const childDocTypeName = tf.options as string;
      if (!childDocTypeName || !this.registry.has(childDocTypeName)) continue;

      const childMeta = this.registry.get(childDocTypeName);
      const childDisplayFields = childMeta.fields.filter(
        (f) => !f.hidden && f.fieldtype !== 'Table' && f.fieldtype !== 'Password',
      );

      const theadHtml = childDisplayFields.map((f) => `<th>${f.label}</th>`).join('');
      const tbodyHtml = childRows
        .map((row: any) => {
          const cells = childDisplayFields
            .map((f) => {
              const v = row[f.fieldname];
              return `<td>${v !== undefined && v !== null ? v : ''}</td>`;
            })
            .join('');
          return `<tr>${cells}</tr>`;
        })
        .join('\n');

      tablesHtml += `
        <div class="child-table-section">
          <h3>${tf.label}</h3>
          <table class="child-table">
            <thead>
              <tr>
                ${theadHtml}
              </tr>
            </thead>
            <tbody>
              ${tbodyHtml || '<tr><td colspan="' + childDisplayFields.length + '" style="text-align:center; color:#888;">No items</td></tr>'}
            </tbody>
          </table>
        </div>`;
    }

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${meta.name} - ${doc.name}</title>
  <style>
    @page { size: A4; margin: 15mm; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #1f2937;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      font-size: 13px;
      line-height: 1.5;
    }
    .print-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #e5e7eb;
      padding-bottom: 12px;
      margin-bottom: 20px;
    }
    .print-header h1 {
      margin: 0;
      font-size: 20px;
      font-weight: 700;
      color: #111827;
    }
    .print-header .subtitle {
      font-size: 12px;
      color: #6b7280;
    }
    .badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-draft { background: #fef3c7; color: #92400e; }
    .badge-submitted { background: #d1fae5; color: #065f46; }
    .badge-cancelled { background: #fee2e2; color: #991b1b; }

    .fields-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px 24px;
      margin-bottom: 24px;
    }
    .field-row {
      display: flex;
      padding: 4px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .field-label {
      width: 40%;
      font-weight: 600;
      color: #4b5563;
    }
    .field-value {
      width: 60%;
      color: #111827;
    }

    .child-table-section {
      margin-top: 24px;
    }
    .child-table-section h3 {
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 8px;
      color: #374151;
    }
    table.child-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 6px;
    }
    table.child-table th, table.child-table td {
      border: 1px solid #e5e7eb;
      padding: 8px 10px;
      text-align: left;
    }
    table.child-table th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
      font-size: 12px;
    }

    .print-footer {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 11px;
      color: #9ca3af;
      display: flex;
      justify-content: space-between;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="print-header">
    <div>
      <h1>${meta.name}: ${doc.name}</h1>
      <div class="subtitle">Created: ${doc.creation || '—'} &bull; Owner: ${doc.owner || 'Administrator'}</div>
    </div>
    <div>
      ${meta.isSubmittable ? `<span class="badge ${badgeClass}">${badgeText}</span>` : ''}
    </div>
  </div>

  <div class="fields-grid">
    ${fieldsHtml}
  </div>

  ${tablesHtml}

  <div class="print-footer">
    <span>Frappe Framework (Node.js)</span>
    <span>Modified: ${doc.modified || '—'}</span>
  </div>
</body>
</html>`;
  }
}
