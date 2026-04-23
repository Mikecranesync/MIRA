import { Users } from "lucide-react";

const TEAM = [
  { name: "Mike Harper",  role: "admin",      dept: "Maintenance",   status: "Active" },
  { name: "John Smith",   role: "technician", dept: "Mechanical",    status: "Active" },
  { name: "Sarah Kim",    role: "operator",   dept: "Production",    status: "Active" },
  { name: "Dave Torres",  role: "scheduler",  dept: "Maintenance",   status: "Active" },
  { name: "Lisa Wong",    role: "manager",    dept: "Engineering",   status: "Active" },
];

export default function TeamPage() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-6">
        <Users className="w-6 h-6 text-blue-600" />
        <h1 className="text-2xl font-bold text-slate-900">Team</h1>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TEAM.map((m) => (
          <div key={m.name} className="bg-white rounded-lg border border-slate-200 p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {m.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-slate-900 truncate">{m.name}</p>
              <p className="text-xs text-slate-500 capitalize">{m.role} · {m.dept}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
