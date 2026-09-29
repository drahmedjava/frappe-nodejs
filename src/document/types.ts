export type FilterOperator = '=' | '!=' | '>' | '<' | '>=' | '<=' | 'like' | 'in' | 'not in';

export type FilterTriple = [string, FilterOperator, any];

export type DocFilters = Record<string, any> | FilterTriple[];

export interface GetListOptions {
  fields?: string[];
  filters?: DocFilters;
  whereIn?: Record<string, any[]>;
  orderBy?: string;
  limit?: number;
  offset?: number;
}

export interface DocumentEventPayload {
  doctype: string;
  name: string;
  doc: any;
  event: string;
}
