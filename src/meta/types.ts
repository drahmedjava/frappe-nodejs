import { z } from 'zod';

export type FieldType =
  | 'Data'
  | 'Text'
  | 'Small Text'
  | 'Long Text'
  | 'Code'
  | 'Int'
  | 'Float'
  | 'Currency'
  | 'Percent'
  | 'Check'
  | 'Select'
  | 'Link'
  | 'Date'
  | 'Datetime'
  | 'Time'
  | 'Table'
  | 'Password'
  | 'ReadOnly';

export interface DocField {
  fieldname: string;
  label: string;
  fieldtype: FieldType;
  options?: string | string[]; // Target DocType for Link/Table, or options for Select
  reqd?: boolean;
  unique?: boolean;
  default?: any;
  readOnly?: boolean;
  hidden?: boolean;
  inList?: boolean;
  inFilter?: boolean;
  description?: string;
  length?: number;
}

export interface DocPermission {
  role: string;
  read?: boolean;
  write?: boolean;
  create?: boolean;
  delete?: boolean;
  submit?: boolean;
  cancel?: boolean;
  amend?: boolean;
}

export type NamingRule = 'autoincrement' | 'hash' | 'prompt' | 'series' | 'field';

export interface DocType {
  name: string;
  module?: string;
  isSingle?: boolean;
  isSubmittable?: boolean;
  isChildTable?: boolean;
  namingRule?: NamingRule;
  autoname?: string; // e.g. "TASK-.#####" or "field:title" or "hash"
  titleField?: string;
  searchFields?: string[];
  fields: DocField[];
  permissions?: DocPermission[];
}

export interface StandardDocFields {
  name: string;
  creation: Date | string;
  modified: Date | string;
  modified_by: string;
  owner: string;
  docstatus: number; // 0: Draft, 1: Submitted, 2: Cancelled
  idx: number;
  parent?: string;
  parenttype?: string;
  parentfield?: string;
}

export const DocFieldSchema = z.object({
  fieldname: z.string().min(1),
  label: z.string().min(1),
  fieldtype: z.enum([
    'Data',
    'Text',
    'Small Text',
    'Long Text',
    'Code',
    'Int',
    'Float',
    'Currency',
    'Percent',
    'Check',
    'Select',
    'Link',
    'Date',
    'Datetime',
    'Time',
    'Table',
    'Password',
    'ReadOnly',
  ]),
  options: z.union([z.string(), z.array(z.string())]).optional(),
  reqd: z.boolean().optional(),
  unique: z.boolean().optional(),
  default: z.any().optional(),
  readOnly: z.boolean().optional(),
  hidden: z.boolean().optional(),
  inList: z.boolean().optional(),
  inFilter: z.boolean().optional(),
  description: z.string().optional(),
  length: z.number().optional(),
});

export const DocPermissionSchema = z.object({
  role: z.string(),
  read: z.boolean().optional(),
  write: z.boolean().optional(),
  create: z.boolean().optional(),
  delete: z.boolean().optional(),
  submit: z.boolean().optional(),
  cancel: z.boolean().optional(),
  amend: z.boolean().optional(),
});

export const DocTypeSchema = z.object({
  name: z.string().min(1),
  module: z.string().optional(),
  isSingle: z.boolean().optional(),
  isSubmittable: z.boolean().optional(),
  isChildTable: z.boolean().optional(),
  namingRule: z.enum(['autoincrement', 'hash', 'prompt', 'series', 'field']).optional(),
  autoname: z.string().optional(),
  titleField: z.string().optional(),
  searchFields: z.array(z.string()).optional(),
  fields: z.array(DocFieldSchema),
  permissions: z.array(DocPermissionSchema).optional(),
});
