"use client";

import { useState } from "react";
import { Database, ExternalLink, CheckCircle2, ClipboardList, Wrench, Calendar, AlertCircle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/providers/toast-provider";

const DEFAULT_CMMS_URL = "https://app.factorylm.com";

const CMMS_SUMMARY = {
  workOrders: { open: 12, inprogress: 4, overdue: 2, completed: 89 },
  assets: { total: 47, active: 44, inactive: 3 },
  pms: { scheduled: 18, overdue: 2 },
};

type Config = { url: string; apiKey: string };

export default function CMMSPage() {
  const { toast } = useToast();
  const [configured, setConfigured] = useState(true);
  const [config, setConfig] = useState<Config>({ url: DEFAULT_CMMS_URL, apiKey: "••••••••••••••••" });
  const [form, setForm] = useState<Config>({ url: "", apiKey: "" });
  const [showEdit, setShowEdit] = useState(false);

  function connect() {
    if (!form.url) { toast("CMMS URL is required", "error"); return; }
    setConfig({ url: form.url, apiKey: form.apiKey });
    setConfigured(true);
    setShowEdit(false);
    toast("Atlas CMMS connected ✓", "success");
  }

  function disconnect() {
    setConfigured(false);
    setConfig({ url: "", apiKey: "" });
    setForm({ url: "", apiKey: "" });
    toast("CMMS disconnected", "warning");
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>CMMS Integration</h1>
              <p className="text-[11px] mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
                {configured ? "Connected to Atlas CMMS" : "Not configured"}
              </p>
            </div>
            {configured && (
              <a href={config.url} target="_blank" rel="noopener noreferrer">
                <Button size="sm" className="h-8 gap-1.5 text-xs">
                  <ExternalLink className="w-3.5 h-3.5" />Open Atlas
                </Button>
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-2xl space-y-4">
        {configured ? (
          <>
            {/* Connected banner */}
            <div className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                <Database className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>Atlas CMMS</p>
                  <Badge variant="green" className="text-[10px] gap-1">
                    <CheckCircle2 className="w-2.5 h-2.5" />Connected
                  </Badge>
                </div>
                <p className="text-xs truncate mt-0.5" style={{ color: "var(--foreground-muted)" }}>{config.url}</p>
              </div>
            </div>

            {/* Open CMMS CTA */}
            <a href={config.url} target="_blank" rel="noopener noreferrer" className="block">
              <Button className="w-full h-11 gap-2 text-sm font-semibold"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                <ExternalLink className="w-4 h-4" />Open Atlas CMMS
              </Button>
            </a>

            {/* Summary cards */}
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>
                CMMS Summary
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div className="card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <ClipboardList className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Work Orders</p>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { label: "Open",        val: CMMS_SUMMARY.workOrders.open,        color: "#2563EB" },
                      { label: "In Progress", val: CMMS_SUMMARY.workOrders.inprogress,  color: "#EAB308" },
                      { label: "Overdue",     val: CMMS_SUMMARY.workOrders.overdue,     color: "#DC2626" },
                      { label: "Completed",   val: CMMS_SUMMARY.workOrders.completed,   color: "#16A34A" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{label}</span>
                        <span className="text-sm font-bold" style={{ color }}>{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
                    <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>Assets</p>
                  </div>
                  <div className="space-y-1.5">
                    {[
                      { label: "Total",    val: CMMS_SUMMARY.assets.total,    color: "var(--foreground)" },
                      { label: "Active",   val: CMMS_SUMMARY.assets.active,   color: "#16A34A" },
                      { label: "Inactive", val: CMMS_SUMMARY.assets.inactive, color: "#94A3B8" },
                    ].map(({ label, val, color }) => (
                      <div key={label} className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{label}</span>
                        <span className="text-sm font-bold" style={{ color }}>{val}</span>
                      </div>
                    ))}
                  </div>

                  <div className="pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <Calendar className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
                      <p className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>PMs</p>
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>Scheduled</span>
                        <span className="text-sm font-bold" style={{ color: "#2563EB" }}>{CMMS_SUMMARY.pms.scheduled}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>Overdue</span>
                        <span className="text-sm font-bold" style={{ color: "#DC2626" }}>{CMMS_SUMMARY.pms.overdue}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Quick links */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>Quick Links</h3>
              <div className="space-y-2">
                {[
                  { label: "Work Orders",  path: "/workorders" },
                  { label: "Assets",       path: "/assets" },
                  { label: "PM Schedule",  path: "/schedule" },
                  { label: "Reports",      path: "/reports" },
                ].map(({ label, path }) => (
                  <a key={path} href={`${config.url}${path}`} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-between p-2.5 rounded-lg transition-colors hover:bg-[var(--surface-1)]">
                    <span className="text-sm" style={{ color: "var(--foreground)" }}>{label}</span>
                    <ExternalLink className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
                  </a>
                ))}
              </div>
            </div>

            {/* Settings */}
            <div className="card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>Connection Settings</h3>
              <div className="space-y-2 mb-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>URL</span>
                  <span className="text-xs font-mono truncate ml-4 max-w-[200px]" style={{ color: "var(--foreground)" }}>{config.url}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>API Key</span>
                  <span className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>••••••••••••</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
                  onClick={() => { setForm({ url: config.url, apiKey: "" }); setShowEdit(true); }}>
                  Edit Settings
                </Button>
                <Button variant="outline" size="sm" className="flex-1 h-8 text-xs"
                  style={{ color: "#DC2626", borderColor: "#DC2626" }}
                  onClick={disconnect}>
                  Disconnect
                </Button>
              </div>
            </div>
          </>
        ) : (
          /* Setup card */
          <div className="card p-6 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto"
              style={{ backgroundColor: "var(--surface-1)" }}>
              <Link2 className="w-7 h-7" style={{ color: "var(--foreground-subtle)" }} />
            </div>
            <div>
              <h2 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>Connect Your CMMS</h2>
              <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>
                Link Atlas CMMS to view your work orders, assets, and PM schedule in one place.
              </p>
            </div>
            <div className="text-left space-y-3">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>
                  CMMS URL *
                </label>
                <Input placeholder="https://your-cmms.factorylm.com"
                  value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>
                  API Key
                </label>
                <Input type="password" placeholder="sk-••••••••"
                  value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} />
              </div>
              <Button onClick={connect} className="w-full h-10 gap-2 font-semibold">
                <Database className="w-4 h-4" />Connect Atlas CMMS
              </Button>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg text-left" style={{ backgroundColor: "rgba(37,99,235,0.08)" }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "var(--brand-blue)" }} />
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Your Atlas CMMS URL is the address where your Atlas instance is hosted.
                Contact your administrator if you don't have access credentials.
              </p>
            </div>
          </div>
        )}

        {/* Edit form modal */}
        {showEdit && (
          <div className="fixed inset-0 z-50 flex items-end" style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
            onClick={() => setShowEdit(false)}>
            <div className="w-full rounded-t-2xl p-5 space-y-4" style={{ backgroundColor: "var(--surface-0)" }}
              onClick={e => e.stopPropagation()}>
              <h3 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Edit CMMS Settings</h3>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>CMMS URL *</label>
                <Input value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wide mb-1 block" style={{ color: "var(--foreground-subtle)" }}>New API Key (leave blank to keep current)</label>
                <Input type="password" placeholder="sk-••••••••" value={form.apiKey} onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1 h-10" onClick={() => setShowEdit(false)}>Cancel</Button>
                <Button className="flex-1 h-10" onClick={connect}>Save</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
