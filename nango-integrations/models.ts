// Nango model types — generated from nango.yaml models section
// Keep in sync with nango.yaml

export interface WorkOrder {
  id: number;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  asset_id: number | null;
  location_id: number | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  work_order_no: string | null;
  categories: string[];
  assignees: { id: number; name: string }[];
}

export interface Asset {
  id: number;
  name: string;
  description: string | null;
  location_id: number | null;
  location_name: string | null;
  make: string | null;
  model: string | null;
  serial_number: string | null;
  status: string | null;
  created_at: string;
  updated_at: string;
}

export interface Part {
  id: number;
  name: string;
  part_number: string | null;
  quantity: number;
  unit_cost: number | null;
  description: string | null;
  location_id: number | null;
}

export interface CreateWorkOrderInput {
  title: string;
  description?: string | null;
  priority?: string | null;
  asset_id?: number | null;
  location_id?: number | null;
  due_date?: string | null;
  assignee_ids?: number[];
}

// Nango SDK types (minimal — full types come from nango package)
export interface NangoSync {
  get<T>(opts: { endpoint: string; params?: Record<string, string | number> }): Promise<{ data: T }>;
  batchSave<T>(records: T[], model: string): Promise<void>;
  batchDelete<T>(records: T[], model: string): Promise<void>;
  log(message: string): Promise<void>;
}

export interface NangoAction {
  get<T>(opts: { endpoint: string; params?: Record<string, string | number> }): Promise<{ data: T }>;
  post<T>(opts: { endpoint: string; data: unknown }): Promise<{ data: T }>;
  log(message: string): Promise<void>;
}
