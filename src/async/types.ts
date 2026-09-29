export interface JobPayload<T = any> {
  id: string;
  name: string;
  data: T;
  timestamp: number;
}

export type JobHandler<T = any> = (data: T) => Promise<any> | any;

export interface RealtimeMessageOptions {
  user?: string;
  room?: string;
  doctype?: string;
  docname?: string;
}
