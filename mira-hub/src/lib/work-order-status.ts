export const WORK_ORDER_IN_PROGRESS_STATUS = "in_progress";

export function isWorkOrderInProgressStatus(status: string | null | undefined) {
  return status === WORK_ORDER_IN_PROGRESS_STATUS || status === "inprogress";
}
