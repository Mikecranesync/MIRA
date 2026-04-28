import type { NangoAction, CreateWorkOrderInput, WorkOrder } from "../../models";

// MaintainX create-work-order action
// Call via: POST /action/trigger with action_name: "create-work-order"
// Or via Nango SDK: nango.triggerAction('maintainx', connectionId, 'create-work-order', input)

export default async function runAction(
  nango: NangoAction,
  input: CreateWorkOrderInput
): Promise<WorkOrder> {
  const body: Record<string, unknown> = {
    title: input.title,
  };

  if (input.description) body.description = input.description;
  if (input.priority) body.priority = input.priority;
  if (input.asset_id) body.assetId = input.asset_id;
  if (input.location_id) body.locationId = input.location_id;
  if (input.due_date) body.dueDate = input.due_date;
  if (input.assignee_ids?.length) {
    body.assignees = input.assignee_ids.map((id: number) => ({ id }));
  }

  const response = await nango.post<{ workOrder: Record<string, unknown> }>({
    endpoint: "/workorders",
    data: body,
  });

  const wo = response.data.workOrder;

  return {
    id: wo.id as number,
    title: wo.title as string,
    description: (wo.description as string | undefined) ?? null,
    status: wo.status as string,
    priority: (wo.priority as string | undefined) ?? null,
    asset_id: (wo.assetId as number | undefined) ?? null,
    location_id: (wo.locationId as number | undefined) ?? null,
    due_date: (wo.dueDate as string | undefined) ?? null,
    created_at: wo.createdAt as string,
    updated_at: wo.updatedAt as string,
    work_order_no: (wo.workOrderNo as string | undefined) ?? null,
    categories: (wo.categories as string[] | undefined) ?? [],
    assignees: ((wo.assignees as { id: number; name: string }[] | undefined) ?? []),
  };
}
