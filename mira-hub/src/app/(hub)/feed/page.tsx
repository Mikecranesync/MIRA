import { LayoutDashboard } from "lucide-react";

export default function FeedPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <LayoutDashboard className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Activity Feed</h1>
      </div>
      <div className="space-y-3">
        {[
          { time: "2 min ago", msg: "WO-2026-002: Conveyor Belt #3 — status changed to In Progress", user: "John S." },
          { time: "1 hr ago",  msg: "WO-2026-001: Air Compressor #1 PM scheduled", user: "Mike H." },
          { time: "3 hr ago",  msg: "Asset HVAC Unit #2 marked as Down", user: "System" },
        ].map((item, i) => (
          <div key={i} className="bg-white rounded-lg border border-slate-200 p-4">
            <div className="flex justify-between items-start">
              <p className="text-sm text-slate-800">{item.msg}</p>
              <span className="text-xs text-slate-400 ml-4 flex-shrink-0">{item.time}</span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{item.user}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
