export interface ErrorDetail {
  title: string;
  status: number;
  detail: string;
}

/** SuccessResponse<T> — for the list/query endpoints. */
export function successList<T>(result: T[]): { success: true; result: T[] } {
  return { success: true, result };
}

export interface BulkItem<T> {
  success: boolean;
  elementId: string;
  result?: T | null;
  responseDetail?: ErrorDetail | null;
}

/** One element's result in a bulk response. Pass `detail` for a per-item error. */
export function bulkItem<T>(elementId: string, result: T | null, detail?: ErrorDetail): BulkItem<T> {
  if (detail) return { success: false, elementId, result: null, responseDetail: detail };
  return { success: true, elementId, result };
}

/** BulkResponse<T> — for /objects/value and /objects/history. */
export function bulk<T>(results: BulkItem<T>[]): { success: true; results: BulkItem<T>[] } {
  return { success: true, results };
}

/** ErrorResponse body. */
export function errorBody(status: number, title: string, detail: string) {
  return { success: false, responseDetail: { title, status, detail } };
}
