import { Wrench, ArrowLeft } from "lucide-react";
import Link from "next/link";

const ASSETS: Record<string, { name: string; type: string; status: string; location: string; lastPM: string; serial: string }> = {
  "1": { name: "Air Compressor #1", type: "Mechanical", status: "Running",  location: "Building A", lastPM: "2026-03-15", serial: "AC-001-2022" },
  "2": { name: "Conveyor Belt #3",  type: "Electrical", status: "Needs PM", location: "Building B", lastPM: "2026-01-20", serial: "CB-003-2021" },
  "3": { name: "CNC Mill #7",       type: "CNC",        status: "Running",  location: "Shop Floor", lastPM: "2026-04-01", serial: "CNC-007-2020" },
  "4": { name: "HVAC Unit #2",      type: "HVAC",       status: "Down",     location: "Roof",       lastPM: "2025-12-10", serial: "HVAC-002-2019" },
  "5": { name: "Pump Station A",    type: "Fluid",      status: "Running",  location: "Basement",   lastPM: "2026-02-28", serial: "PS-A-2023" },
};

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = ASSETS[id] ?? { name: "Unknown", type: "—", status: "—", location: "—", lastPM: "—", serial: "—" };

  return (
    <div className="p-6">
      <Link href="/assets" className="flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Assets
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <Wrench className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">{asset.name}</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          ["Type", asset.type],
          ["Status", asset.status],
          ["Location", asset.location],
          ["Serial #", asset.serial],
          ["Last PM", asset.lastPM],
        ].map(([label, value]) => (
          <div key={label} className="bg-white rounded-lg border border-slate-200 p-4">
            <p className="text-xs text-slate-500 mb-1">{label}</p>
            <p className="font-medium text-slate-900">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
