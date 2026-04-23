import { ClipboardList, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function NewWorkOrderPage() {
  return (
    <div className="p-6 max-w-2xl">
      <Link href="/workorders" className="flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to Work Orders
      </Link>
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">New Work Order</h1>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-5">
        {[
          { label: "Title", type: "text", placeholder: "Describe the work needed" },
          { label: "Asset", type: "text", placeholder: "Search asset name or ID" },
          { label: "Due Date", type: "date", placeholder: "" },
        ].map(({ label, type, placeholder }) => (
          <div key={label}>
            <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
            <input type={type} placeholder={placeholder} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
          <select className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {["Low", "Medium", "High", "Critical"].map((p) => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea rows={4} placeholder="Additional details..." className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
        </div>
        <button type="button" className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          Create Work Order
        </button>
      </div>
    </div>
  );
}
