import { MessageSquare } from "lucide-react";

const REQUESTS = [
  { id: "REQ-001", title: "Weird noise from pump #2",   submitted: "Mike H.",  date: "2026-04-22", status: "Open" },
  { id: "REQ-002", title: "Belt slipping on conveyor",  submitted: "John S.", date: "2026-04-21", status: "In Review" },
  { id: "REQ-003", title: "Lights flickering in Bay 3", submitted: "Sarah K.", date: "2026-04-20", status: "Converted to WO" },
];

export default function RequestsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <MessageSquare className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900">Maintenance Requests</h1>
        </div>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          + New Request
        </button>
      </div>
      <div className="space-y-3">
        {REQUESTS.map((r) => (
          <div key={r.id} className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm text-slate-900">{r.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{r.submitted} · {r.date}</p>
            </div>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full">{r.status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
