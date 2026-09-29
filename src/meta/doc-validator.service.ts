import { Injectable } from '@nestjs/common';
import { DocField, DocType } from './types';
import { DocTypeRegistryService } from './doctype-registry.service';

export interface ValidationErrorItem {
  field: string;
  message: string;
  value?: any;
}

export class DocValidationError extends Error {
  public errors: ValidationErrorItem[];

  constructor(doctype: string, errors: ValidationErrorItem[]) {
    const message = `Validation failed for ${doctype}: ${errors.map((e) => `${e.field} (${e.message})`).join(', ')}`;
    super(message);
    this.name = 'DocValidationError';
    this.errors = errors;
  }
}

@Injectable()
export class DocValidatorService {
  constructor(private readonly registry: DocTypeRegistryService) {}

  /**
   * Validates document payload against DocType metadata.
   * Performs coercion (e.g. string to number, 1/0 to boolean for Check),
   * sets default values for missing fields, and enforces mandatory & type rules.
   */
  validate(docType: DocType, rawData: Record<string, any>, isNew = false): Record<string, any> {
    const errors: ValidationErrorItem[] = [];
    const cleaned: Record<string, any> = { ...rawData };

    for (const field of docType.fields) {
      const { fieldname, fieldtype, reqd, options, default: defaultValue } = field;
      let val = cleaned[fieldname];

      // Assign default if new doc and value is undefined
      if (isNew && (val === undefined || val === null) && defaultValue !== undefined) {
        val = defaultValue;
        cleaned[fieldname] = val;
      }

      // Skip Table fields here; child tables are validated separately
      if (fieldtype === 'Table') {
        if (val !== undefined && val !== null) {
          if (!Array.isArray(val)) {
            errors.push({ field: fieldname, message: 'Child table value must be an array', value: val });
          } else if (typeof options === 'string' && this.registry.has(options)) {
            const childDocType = this.registry.get(options);
            cleaned[fieldname] = val.map((row, idx) => {
              try {
                return this.validate(childDocType, row, isNew);
              } catch (err: any) {
                if (err instanceof DocValidationError) {
                  for (const childErr of err.errors) {
                    errors.push({
                      field: `${fieldname}[${idx}].${childErr.field}`,
                      message: childErr.message,
                      value: childErr.value,
                    });
                  }
                } else {
                  errors.push({ field: `${fieldname}[${idx}]`, message: err.message });
                }
                return row;
              }
            });
          }
        }
        continue;
      }

      // Mandatory check
      if (reqd && isNew && (val === undefined || val === null || val === '')) {
        errors.push({ field: fieldname, message: `Field is required` });
        continue;
      }

      // If value is not provided and not required, skip type validation
      if (val === undefined || val === null || val === '') {
        continue;
      }

      // Type-specific validations and coercions
      switch (fieldtype) {
        case 'Int': {
          const num = Number(val);
          if (!Number.isInteger(num)) {
            errors.push({ field: fieldname, message: 'Must be an integer', value: val });
          } else {
            cleaned[fieldname] = num;
          }
          break;
        }

        case 'Float':
        case 'Currency':
        case 'Percent': {
          const num = Number(val);
          if (isNaN(num) || !isFinite(num)) {
            errors.push({ field: fieldname, message: 'Must be a valid number', value: val });
          } else {
            cleaned[fieldname] = num;
          }
          break;
        }

        case 'Check': {
          if (val === true || val === 1 || val === '1' || val === 'true') {
            cleaned[fieldname] = 1;
          } else if (val === false || val === 0 || val === '0' || val === 'false') {
            cleaned[fieldname] = 0;
          } else {
            errors.push({ field: fieldname, message: 'Must be a boolean (1 or 0)', value: val });
          }
          break;
        }

        case 'Select': {
          const allowed = Array.isArray(options)
            ? options
            : typeof options === 'string'
              ? options.split('\n').map((s) => s.trim()).filter(Boolean)
              : [];

          if (allowed.length > 0 && !allowed.includes(String(val))) {
            errors.push({
              field: fieldname,
              message: `Invalid option. Allowed: ${allowed.join(', ')}`,
              value: val,
            });
          }
          break;
        }

        case 'Date': {
          const dateStr = String(val);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) && isNaN(Date.parse(dateStr))) {
            errors.push({ field: fieldname, message: 'Invalid date format (expected YYYY-MM-DD)', value: val });
          }
          break;
        }

        case 'Datetime': {
          if (isNaN(Date.parse(String(val)))) {
            errors.push({ field: fieldname, message: 'Invalid datetime format', value: val });
          }
          break;
        }

        case 'Data':
        case 'Link':
        case 'Password': {
          if (typeof val !== 'string' && typeof val !== 'number') {
            errors.push({ field: fieldname, message: 'Must be a string', value: val });
          } else {
            const strVal = String(val);
            const maxLen = field.length || 255;
            if (strVal.length > maxLen) {
              errors.push({ field: fieldname, message: `Exceeds max length of ${maxLen}`, value: val });
            }
            cleaned[fieldname] = strVal;
          }
          break;
        }
      }
    }

    if (errors.length > 0) {
      throw new DocValidationError(docType.name, errors);
    }

    return cleaned;
  }
}
