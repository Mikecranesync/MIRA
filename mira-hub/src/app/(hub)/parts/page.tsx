import { Package } from "lucide-react";

const PARTS = [
  { id: "P-001", name: "Air Filter — Compressor",  qty: 12, unit: "ea", location: "Shelf A-3", reorder: 5 },
  { id: "P-002", name: "Belt Drive — 5/8\" x 48\"", qty: 3,  unit: "ea", location: "Shelf B-1", reorder: 2 },
  { id: "P-003", name: "Hydraulic Oil — ISO 46",   qty: 20, unit: "L",  location: "Tank Room",  reorder: 10 },
  { id: "P-004", name: "Contactor 40A 3-Pole",     qty: 2,  unit: "ea", location: "Elec Panel", reorder: 1 },
];

export default function PartsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Package className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Parts Inventory</h1>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Part #", "Name", "Qty", "Unit", "Location", "Reorder At"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {PARTS.map((p) => (
              <tr key={p.id} className={`hover:bg-slate-50 ${p.qty <= p.reorder ? "bg-red-50" : ""}`}>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{p.id}</td>
                <td className="px-4 py-3 font-medium">{p.name}</td>
                <td className="px-4 py-3 font-bold text-slate-800">{p.qty}</td>
                <td className="px-4 py-3 text-slate-500">{p.unit}</td>
                <td className="px-4 py-3 text-slate-600">{p.location}</td>
                <td className="px-4 py-3 text-slate-600">{p.reorder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
