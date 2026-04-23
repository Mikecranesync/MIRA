import { Settings } from "lucide-react";

const USERS = [
  { email: "mike@factorylm.com",  name: "Mike Harper",  role: "admin",      last: "2026-04-22" },
  { email: "john@factorylm.com",  name: "John Smith",   role: "technician", last: "2026-04-22" },
  { email: "sarah@factorylm.com", name: "Sarah Kim",    role: "operator",   last: "2026-04-21" },
  { email: "dave@factorylm.com",  name: "Dave Torres",  role: "scheduler",  last: "2026-04-20" },
  { email: "lisa@factorylm.com",  name: "Lisa Wong",    role: "manager",    last: "2026-04-19" },
];

export default function AdminUsersPage() {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Settings className="w-6 h-6 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900">Admin — Users</h1>
        </div>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          + Invite User
        </button>
      </div>
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {["Name", "Email", "Role", "Last Active", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-medium text-slate-600">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {USERS.map((u) => (
              <tr key={u.email} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3 capitalize">{u.role}</td>
                <td className="px-4 py-3 text-slate-500">{u.last}</td>
                <td className="px-4 py-3">
                  <button className="text-blue-600 text-xs hover:underline mr-3">Edit</button>
                  <button className="text-red-500 text-xs hover:underline">Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
