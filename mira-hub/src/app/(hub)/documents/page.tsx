import { FileText } from "lucide-react";

const DOCS = [
  { name: "Air Compressor #1 — OEM Manual",   type: "PDF",  size: "4.2 MB", updated: "2026-03-01" },
  { name: "Conveyor Belt Maintenance Guide",  type: "PDF",  size: "1.8 MB", updated: "2025-11-15" },
  { name: "HVAC Inspection Checklist",        type: "DOCX", size: "0.3 MB", updated: "2026-01-10" },
];

export default function DocumentsPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <FileText className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Documents</h1>
      </div>
      <div className="space-y-3">
        {DOCS.map((d) => (
          <div key={d.name} className="bg-white rounded-lg border border-slate-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-slate-400" />
              <div>
                <p className="font-medium text-sm text-slate-900">{d.name}</p>
                <p className="text-xs text-slate-500">{d.type} · {d.size} · Updated {d.updated}</p>
              </div>
            </div>
            <button className="text-blue-600 text-sm hover:underline">Download</button>
          </div>
        ))}
      </div>
    </div>
  );
}
