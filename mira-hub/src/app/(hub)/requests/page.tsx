"use client";

import { useState } from "react";
import { MessageSquare, Plus, X, CheckCircle, XCircle, Clock, ChevronRight, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/providers/toast-provider";

type Request = {
  id: string;
  title: string;
  description: string;
  asset: string;
  priority: "low" | "medium" | "high" | "critical";
  submittedBy: string;
  date: string;
  status: "pending" | "approved" | "rejected" | "converted";
  woId?: string;
};

const INITIAL_REQUESTS: Request[] = [
  {
    id: "REQ-001", title: "Unusual noise from pump station",
    description: "High-pitched squealing starts ~10 min after startup. Getting louder each day.",
    asset: "Pump Station A", priority: "high", submittedBy: "Mike H.", date: "2026-04-22",
    status: "pending",
  },
  {
    id: "REQ-002", title: "Belt slipping on Conveyor #3",
    description: "Belt drifts to the right under load. Adjusted twice already — keeps returning.",
    asset: "Conveyor Belt #3", priority: "medium", submittedBy: "John S.", date: "2026-04-21",
    status: "approved",
  },
  {
    id: "REQ-003", title: "Lights flickering in Bay 3",
    description: "Fluorescent lights near CNC area flicker intermittently. Safety concern.",
    asset: "Electrical — Bay 3", priority: "medium", submittedBy: "Sara K.", date: "2026-04-20",
    status: "converted", woId: "WO-2026-011",
  },
  {
    id: "REQ-004", title: "Air compressor pressure dropping",
    description: "System pressure falls below 90 PSI after 30 min of run time.",
    asset: "Air Compressor #1", priority: "critical", submittedBy: "Mike H.", date: "2026-04-19",
    status: "pending",
  },
  {
    id: "REQ-005", title: "CNC coolant smell",
    description: "Coolant smells burnt/sour — possibly microbial growth. Need inspection.",
    asset: "CNC Mill #7", priority: "low", submittedBy: "John S.", date: "2026-04-17",
    status: "rejected",
  },
];

const PRIORITY_CFG = {
  low:      { badgeVariant: "low"      as const },
  medium:   { badgeVariant: "medium"   as const },
  high:     { badgeVariant: "high"     as const },
  critical: { badgeVariant: "critical" as const },
};

const STATUS_CFG = {
  pending:   { label: "Pending",        badgeVariant: "secondary"  as const, icon: Clock },
  approved:  { label: "Approved",       badgeVariant: "green"      as const, icon: CheckCircle },
  rejected:  { label: "Rejected",       badgeVariant: "red"        as const, icon: XCircle },
  converted: { label: "Converted to WO",badgeVariant: "inprogress" as const, icon: ArrowRight },
};

const STATUS_FILTERS = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "approved",  label: "Approved" },
  { key: "rejected",  label: "Rejected" },
  { key: "converted", label: "Converted" },
];

const ASSETS = ["Air Compressor #1","Conveyor Belt #3","CNC Mill #7","Pump Station A","HVAC Unit #2","Generator #1","Electrical — Bay 3"];

export default function RequestsPage() {
  const [requests, setRequests] = useState<Request[]>(INITIAL_REQUESTS);
  const [statusFilter, setStatusFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { toast } = useToast();

  // Form state
  const [form, setForm] = useState({ title: "", description: "", asset: "", priority: "medium" as Request["priority"] });

  const visible = statusFilter === "all" ? requests : requests.filter(r => r.status === statusFilter);
  const pendingCount = requests.filter(r => r.status === "pending").length;

  function submitRequest() {
    if (!form.title || !form.asset) return;
    toast("Request submitted — team notified");
    const newReq: Request = {
      id: `REQ-${String(requests.length + 1).padStart(3, "0")}`,
      title: form.title,
      description: form.description,
      asset: form.asset,
      priority: form.priority,
      submittedBy: "Mike H.",
      date: new Date().toISOString().slice(0, 10),
      status: "pending",
    };
    setRequests(prev => [newReq, ...prev]);
    setForm({ title: "", description: "", asset: "", priority: "medium" });
    setShowForm(false);
  }

  function approve(id: string) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "approved" } : r));
    toast("Request approved ✓", "success");
  }
  function reject(id: string) {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status: "rejected" } : r));
    toast("Request rejected", "warning");
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Maintenance Requests</h1>
              {pendingCount > 0 && (
                <span className="text-[11px] font-medium" style={{ color: "var(--status-yellow)" }}>{pendingCount} awaiting review</span>
              )}
            </div>
            <Button size="sm" onClick={() => setShowForm(true)} className="h-8 gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" />New Request
            </Button>
          </div>

          {/* Status filter */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setStatusFilter(f.key)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{ backgroundColor: statusFilter === f.key ? "var(--brand-blue)" : "var(--surface-1)", color: statusFilter === f.key ? "white" : "var(--foreground-muted)" }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* New Request form */}
      {showForm && (
        <div className="mx-4 md:mx-6 mt-4">
          <div className="card p-4 space-y-3">
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Submit a Request</h3>
              <button onClick={() => setShowForm(false)} style={{ color: "var(--foreground-subtle)" }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>Title *</label>
              <Input placeholder="Briefly describe the issue…" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>Asset *</label>
              <select value={form.asset} onChange={e => setForm(f => ({ ...f, asset: e.target.value }))}
                className="w-full text-xs px-3 py-2 rounded-lg border"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }}>
                <option value="">Select asset…</option>
                {ASSETS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>Priority</label>
              <div className="flex gap-2">
                {(["low","medium","high","critical"] as Request["priority"][]).map(p => (
                  <button key={p} onClick={() => setForm(f => ({ ...f, priority: p }))}
                    className="flex-1 py-1.5 rounded-lg text-xs font-medium border capitalize transition-all"
                    style={{
                      borderColor: form.priority === p ? "var(--brand-blue)" : "var(--border)",
                      backgroundColor: form.priority === p ? "rgba(37,99,235,0.1)" : "transparent",
                      color: form.priority === p ? "var(--brand-blue)" : "var(--foreground-muted)",
                    }}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>Description</label>
              <textarea rows={3} placeholder="More details…" value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                className="w-full text-xs px-3 py-2 rounded-lg border resize-none"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }} />
            </div>
            <Button onClick={submitRequest} className="w-full h-9 text-sm">Submit Request</Button>
          </div>
        </div>
      )}

      {/* Request list */}
      <div className="px-4 md:px-6 py-4 space-y-3">
        {visible.length === 0 ? (
          <div className="text-center py-16">
            <MessageSquare className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>No requests in this category</p>
          </div>
        ) : visible.map(req => {
          const sCfg = STATUS_CFG[req.status];
          const pCfg = PRIORITY_CFG[req.priority];
          const StatusIcon = sCfg.icon;
          const isExpanded = expanded === req.id;

          return (
            <div key={req.id} className="card overflow-hidden">
              <button onClick={() => setExpanded(isExpanded ? null : req.id)} className="w-full text-left p-4">
                <div className="flex items-start gap-3">
                  <StatusIcon className="w-4 h-4 flex-shrink-0 mt-0.5"
                    style={{ color: req.status === "approved" ? "#16A34A" : req.status === "rejected" ? "#DC2626" : req.status === "converted" ? "#EAB308" : "var(--foreground-subtle)" }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>{req.title}</p>
                      <ChevronRight className="w-4 h-4 flex-shrink-0 transition-transform" style={{ color: "var(--foreground-subtle)", transform: isExpanded ? "rotate(90deg)" : "none" }} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-1.5">
                      <Badge variant={pCfg.badgeVariant} className="text-[10px] capitalize">{req.priority}</Badge>
                      <Badge variant={sCfg.badgeVariant} className="text-[10px]">{sCfg.label}</Badge>
                      {req.woId && <span className="text-[11px] font-mono" style={{ color: "var(--brand-blue)" }}>{req.woId}</span>}
                    </div>
                    <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
                      {req.asset} · {req.submittedBy} · {req.date}
                    </p>
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: "var(--border)" }}>
                  <p className="text-xs mt-3 mb-4" style={{ color: "var(--foreground-muted)" }}>{req.description || "No description provided."}</p>
                  {req.status === "pending" && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => { reject(req.id); setExpanded(null); }}>
                        <XCircle className="w-3.5 h-3.5" />Reject
                      </Button>
                      <Button size="sm" className="flex-1 h-8 text-xs gap-1.5"
                        onClick={() => { approve(req.id); setExpanded(null); }}>
                        <CheckCircle className="w-3.5 h-3.5" />Approve
                      </Button>
                    </div>
                  )}
                  {req.status === "approved" && (
                    <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                      Approved — create a Work Order to assign and schedule this work.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
