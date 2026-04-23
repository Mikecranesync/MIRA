import { Calendar } from "lucide-react";

const SCHEDULED = [
  { id: "PM-001", title: "Air Compressor PM",       asset: "Air Compressor #1", date: "2026-04-25", tech: "Mike H.",  recur: "Monthly" },
  { id: "PM-002", title: "Conveyor Lubrication",    asset: "Conveyor Belt #3",  date: "2026-04-28", tech: "John S.", recur: "Weekly" },
  { id: "PM-003", title: "HVAC Filter Change",      asset: "HVAC Unit #2",      date: "2026-05-01", tech: "—",       recur: "Quarterly" },
  { id: "PM-004", title: "CNC Calibration Check",   asset: "CNC Mill #7",       date: "2026-05-05", tech: "Mike H.", recur: "Monthly" },
];

export default function SchedulePage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Calendar className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">PM Schedule</h1>
      </div>
      <div className="space-y-3">
        {SCHEDULED.map((s) => (
          <div key={s.id} className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-sm text-slate-900">{s.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.asset} · {s.tech} · {s.recur}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-medium text-slate-700">{s.date}</p>
              <p className="text-xs font-mono text-slate-400">{s.id}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
