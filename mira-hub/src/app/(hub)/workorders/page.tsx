import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";

const ORDERS = [
  { id: "WO-2026-001", title: "PM Air Compressor #1",     priority: "High",     status: "Open",        assignee: "Mike H.", due: "2026-04-25" },
  { id: "WO-2026-002", title: "Replace conveyor belt",     priority: "Critical", status: "In Progress", assignee: "John S.", due: "2026-04-23" },
  { id: "WO-2026-003", title: "Quarterly HVAC inspection", priority: "Medium",   status: "Open",        assignee: "—",       due: "2026-04-30" },
  { id: "WO-2026-004", title: "Lubrication PM cycle",      priority: "Low",      status: "Scheduled",   assignee: "Mike H.", due: "2026-05-01" },
];

const PRIORITY_COLOR: Record<string, string> = {
  Critical: "bg-red-100 text-red-700",
  High:     "bg-orange-100 text-orange-700",
  Medium:   "bg-yellow-100 text-yellow-700",
  Low:      "bg-slate-100 text-slate-600",
};

export default function WorkOrdersPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900">Work Orders</h1>
        </div>
        <Link href="/workorders/new" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> New Order
        </Link>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["ID", "Title", "Priority", "Status", "Assignee", "Due"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ORDERS.map((o) => (
              <tr key={o.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{o.id}</td>
                <td className="px-4 py-3 font-medium">{o.title}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLOR[o.priority]}`}>{o.priority}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{o.status}</td>
                <td className="px-4 py-3 text-slate-600">{o.assignee}</td>
                <td className="px-4 py-3 text-slate-600">{o.due}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
