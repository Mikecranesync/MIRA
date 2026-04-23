"use client";

import { use, useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft, Play, Square, Bot, Package, MessageSquare,
  Clock, User, Calendar, Wrench, CheckCircle2, AlertCircle,
  AlertTriangle, ChevronRight, Plus, Camera, ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WORK_ORDERS, STATUS_LABEL, PRIORITY_VARIANT, STATUS_VARIANT, type WOStatus } from "@/lib/workorders-data";
import { PARTS } from "@/lib/parts-data";
import { useToast } from "@/providers/toast-provider";

const STATUS_ICON: Record<WOStatus, React.ElementType> = {
  open: Clock, inprogress: Wrench, scheduled: Calendar,
  completed: CheckCircle2, overdue: AlertCircle,
};

const STATUS_COLOR: Record<WOStatus, string> = {
  open: "#2563EB", inprogress: "#EAB308", scheduled: "#64748B",
  completed: "#16A34A", overdue: "#DC2626",
};

function formatTimer(s: number) {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function WorkOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const wo = WORK_ORDERS.find(w => w.id === id) ?? WORK_ORDERS[0];

  const [status, setStatus] = useState<WOStatus>(wo.status);
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [partsUsed, setPartsUsed] = useState(wo.partsUsed);
  const [comments, setComments] = useState(wo.comments);
  const [commentText, setCommentText] = useState("");
  const [showPartPicker, setShowPartPicker] = useState(false);
  const [partQuery, setPartQuery] = useState("");
  const { toast } = useToast();
  const t = useTranslations("workorders");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timerRunning) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timerRunning]);

  function startWork() {
    setStatus("inprogress");
    setTimerRunning(true);
    toast(t("started"));
  }
  function stopTimer() {
    setTimerRunning(false);
    toast(t("paused", { time: formatTimer(elapsed) }));
  }
  function completeWO() {
    setTimerRunning(false);
    setStatus("completed");
    toast(t("markedComplete"));
  }

  function addComment() {
    if (!commentText.trim()) return;
    setComments(prev => [...prev, { author: "Mike H.", ts: new Date().toISOString().slice(0, 16).replace("T", " "), text: commentText }]);
    setCommentText("");
    toast(t("commentAdded"));
  }

  function addPart(part: typeof PARTS[number]) {
    const existing = partsUsed.find(p => p.partId === part.id);
    if (existing) {
      setPartsUsed(prev => prev.map(p => p.partId === part.id ? { ...p, qty: p.qty + 1 } : p));
    } else {
      setPartsUsed(prev => [...prev, { partId: part.id, partNumber: part.partNumber, description: part.description, qty: 1 }]);
    }
    setShowPartPicker(false);
    setPartQuery("");
    toast(t("partAdded", { name: part.description }));
  }

  const StatusIcon = STATUS_ICON[status];
  const filteredParts = PARTS.filter(p =>
    !partQuery || p.description.toLowerCase().includes(partQuery.toLowerCase()) || p.partNumber.toLowerCase().includes(partQuery.toLowerCase())
  );

  return (
    <div className="min-h-full pb-24" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <Link href="/workorders" className="inline-flex items-center gap-1 text-xs mb-2" style={{ color: "var(--brand-blue)" }}>
            <ArrowLeft className="w-3.5 h-3.5" />{t("title")}
          </Link>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>{wo.id}</span>
                <Badge variant={PRIORITY_VARIANT[wo.priority]}>{wo.priority}</Badge>
                <Badge variant={STATUS_VARIANT[status] ?? "gray"} className="gap-1">
                  <StatusIcon className="w-2.5 h-2.5" />{STATUS_LABEL[status]}
                </Badge>
              </div>
              <h1 className="text-base font-semibold mt-1 leading-snug" style={{ color: "var(--foreground)" }}>{wo.desc}</h1>
              <Link href={`/assets/${wo.assetId}`} className="text-xs flex items-center gap-1 mt-0.5" style={{ color: "var(--brand-blue)" }}>
                <Wrench className="w-3 h-3" />{wo.asset} <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 max-w-2xl space-y-4">
        {/* Ask MIRA CTA */}
        <div className="flex gap-2">
          <a href="https://t.me/FactoryLMDiagnose_bot" target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button className="w-full h-10 gap-2 text-sm font-semibold"
              style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
              <Bot className="w-4 h-4" />{t("viewMira")}
            </Button>
          </a>
          <a href={`https://app.factorylm.com/workorders/${wo.id}`} target="_blank" rel="noopener noreferrer">
            <Button variant="outline" className="h-10 gap-1.5 text-sm px-3">
              <ExternalLink className="w-4 h-4" />{t("openCmms")}
            </Button>
          </a>
        </div>

        {/* Time Tracker */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>{t("timeTracker")}</h3>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-3xl font-mono font-bold" style={{ color: timerRunning ? "var(--brand-blue)" : "var(--foreground)" }}>
                {formatTimer(elapsed)}
              </div>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
                {t("estimated")} {wo.estimatedH}h · {wo.type}
              </p>
            </div>
            <div className="flex gap-2">
              {!timerRunning ? (
                <Button size="sm" onClick={startWork} className="gap-1.5 h-9"
                  style={status === "completed" ? { opacity: 0.5, pointerEvents: "none" } : {}}>
                  <Play className="w-3.5 h-3.5" />
                  {status === "open" || status === "scheduled" ? t("startWork") : t("resume")}
                </Button>
              ) : (
                <Button size="sm" variant="outline" onClick={stopTimer} className="gap-1.5 h-9">
                  <Square className="w-3.5 h-3.5" />{t("pause")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t("assignedTo"), value: wo.assignee, Icon: User },
            { label: t("dueDate"),    value: wo.due,       Icon: Calendar },
            { label: t("created"),    value: wo.created,   Icon: Clock },
            { label: t("type"),       value: wo.type,      Icon: Wrench },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="card p-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3 h-3" style={{ color: "var(--foreground-subtle)" }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>{label}</span>
              </div>
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Notes */}
        {wo.notes && (
          <div className="card p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--foreground-subtle)" }}>{t("workInstructions")}</h3>
            <p className="text-sm leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{wo.notes}</p>
          </div>
        )}

        {/* Photo placeholder */}
        <div className="card p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "var(--surface-1)" }}>
            <Camera className="w-5 h-5" style={{ color: "var(--foreground-subtle)" }} />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{t("photos")}</p>
            <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{t("noPhotos")}</p>
          </div>
          <Button variant="outline" size="sm" className="text-xs">+ {t("addPhoto")}</Button>
        </div>

        {/* Parts Used */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>{t("partsUsed")}</h3>
            <button onClick={() => setShowPartPicker(v => !v)}
              className="flex items-center gap-1 text-xs font-medium" style={{ color: "var(--brand-blue)" }}>
              <Plus className="w-3.5 h-3.5" />{t("logPart")}
            </button>
          </div>

          {showPartPicker && (
            <div className="mb-3 p-3 rounded-lg border space-y-2" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-1)" }}>
              <input placeholder={t("searchParts")} value={partQuery} onChange={e => setPartQuery(e.target.value)}
                className="w-full text-xs px-3 py-2 rounded-lg border"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }} />
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {filteredParts.slice(0, 8).map(p => (
                  <button key={p.id} onClick={() => addPart(p)}
                    className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-[var(--surface-0)] transition-colors"
                    style={{ color: "var(--foreground)" }}>
                    <span className="font-mono text-[10px] mr-2" style={{ color: "var(--foreground-subtle)" }}>{p.partNumber}</span>
                    {p.description}
                  </button>
                ))}
              </div>
            </div>
          )}

          {partsUsed.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{t("noPartsLogged")}</p>
          ) : (
            <div className="space-y-2">
              {partsUsed.map(p => (
                <div key={p.partId} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
                    <div>
                      <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{p.description}</p>
                      <p className="text-[10px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{p.partNumber}</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold" style={{ color: "var(--foreground-muted)" }}>×{p.qty}</span>
                </div>
              ))}
              <Link href="/parts" className="text-xs font-medium mt-1 inline-block" style={{ color: "var(--brand-blue)" }}>
                {t("viewInventory")} →
              </Link>
            </div>
          )}
        </div>

        {/* Comments */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>{t("comments")}</h3>
          <div className="space-y-3 mb-3">
            {comments.length === 0 && <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{t("noComments")}</p>}
            {comments.map((c, i) => (
              <div key={i} className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                  {c.author.split(" ").map(n => n[0]).join("")}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-[11px] font-medium" style={{ color: "var(--foreground)" }}>{c.author}</span>
                    <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{c.ts}</span>
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{c.text}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder={t("addComment")}
              onKeyDown={e => e.key === "Enter" && addComment()}
              className="flex-1 text-xs px-3 py-2 rounded-lg border"
              style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }} />
            <Button size="sm" onClick={addComment} className="h-8 px-3">
              <MessageSquare className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Status actions */}
        {status !== "completed" && (
          <div className="space-y-2">
            {status === "inprogress" && (
              <Button onClick={completeWO} className="w-full h-11 gap-2 font-semibold"
                style={{ backgroundColor: "#16A34A" }}>
                <CheckCircle2 className="w-4 h-4" />{t("markComplete")}
              </Button>
            )}
            {(status === "open" || status === "scheduled") && (
              <Button onClick={startWork} className="w-full h-11 gap-2 font-semibold">
                <Play className="w-4 h-4" />{t("startWork")}
              </Button>
            )}
            {status === "overdue" && (
              <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: "#FEF2F2" }}>
                <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#DC2626" }} />
                <p className="text-xs font-medium" style={{ color: "#DC2626" }}>{t("overdueWarning")}</p>
              </div>
            )}
          </div>
        )}
        {status === "completed" && (
          <div className="flex items-center gap-2 p-3 rounded-xl" style={{ backgroundColor: "#DCFCE7" }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: "#16A34A" }} />
            <p className="text-xs font-medium" style={{ color: "#16A34A" }}>{t("completedMessage")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
