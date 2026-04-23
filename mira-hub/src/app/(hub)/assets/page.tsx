import Link from "next/link";
import { Wrench } from "lucide-react";

const ASSETS = [
  { id: "1", name: "Air Compressor #1",  type: "Mechanical", status: "Running",  location: "Building A" },
  { id: "2", name: "Conveyor Belt #3",   type: "Electrical", status: "Needs PM", location: "Building B" },
  { id: "3", name: "CNC Mill #7",        type: "CNC",        status: "Running",  location: "Shop Floor" },
  { id: "4", name: "HVAC Unit #2",       type: "HVAC",       status: "Down",     location: "Roof" },
  { id: "5", name: "Pump Station A",     type: "Fluid",      status: "Running",  location: "Basement" },
];

const STATUS_COLOR: Record<string, string> = {
  Running:  "bg-green-100 text-green-700",
  "Needs PM": "bg-yellow-100 text-yellow-700",
  Down:     "bg-red-100 text-red-700",
  Scheduled: "bg-blue-100 text-blue-700",
};

export default function AssetsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Wrench className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Assets</h1>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Name", "Type", "Status", "Location"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ASSETS.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/assets/${a.id}`} className="text-blue-600 hover:underline font-medium">{a.name}</Link>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.type}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[a.status] ?? ""}`}>{a.status}</span>
                </td>
                <td className="px-4 py-3 text-slate-600">{a.location}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
