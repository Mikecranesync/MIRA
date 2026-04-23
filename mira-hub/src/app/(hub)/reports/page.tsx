import { BarChart2 } from "lucide-react";

const METRICS = [
  { label: "MTBF (Avg)",       value: "312 hrs",  delta: "+8%"  },
  { label: "MTTR (Avg)",       value: "2.4 hrs",  delta: "-12%" },
  { label: "PM Compliance",    value: "87%",      delta: "+3%"  },
  { label: "Open Work Orders", value: "7",        delta: "—"    },
];

export default function ReportsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <BarChart2 className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Reports</h1>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {METRICS.map((m) => (
          <div key={m.label} className="bg-white rounded-lg border border-slate-200 p-5">
            <p className="text-xs text-slate-500 mb-1">{m.label}</p>
            <p className="text-2xl font-bold text-slate-900">{m.value}</p>
            <p className={`text-xs mt-1 ${m.delta.startsWith("+") ? "text-green-600" : m.delta.startsWith("-") ? "text-red-600" : "text-slate-400"}`}>{m.delta} vs last month</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-6">
        <p className="text-sm text-slate-400 text-center py-10">Charts powered by Recharts — data from mira-pipeline (:9099)</p>
      </div>
    </div>
  );
}
