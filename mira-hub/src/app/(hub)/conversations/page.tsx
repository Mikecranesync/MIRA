"use client";

import { useState } from "react";
import { Search, MessageSquare, ChevronRight, X, Send } from "lucide-react";
import { useTranslations } from "next-intl";

type Message = { role: "tech" | "mira"; text: string; ts: string };

type Conversation = {
  id: string;
  tech: string;
  techInitials: string;
  channel: string;
  channelEmoji: string;
  lastMessage: string;
  ts: string;
  asset: string | null;
  unread: number;
  messages: Message[];
};

const CONVERSATIONS: Conversation[] = [
  {
    id: "c001", tech: "John Smith", techInitials: "JS",
    channel: "Telegram", channelEmoji: "✈️",
    lastMessage: "Got it, I'll lubricate the drive-end bearing now",
    ts: "9:12 AM", asset: "Air Compressor #1", unread: 0,
    messages: [
      { role: "tech", text: "AC1 is running hot, making a grinding noise near the motor housing", ts: "9:05 AM" },
      { role: "mira", text: "Elevated bearing temperature detected (82°C vs 65°C baseline). Most likely cause: insufficient lubrication (confidence 84%). Recommended: Lubricate drive-end bearing per OEM spec immediately. Part FAG-6308-2RS available at A-2-3 if replacement needed.", ts: "9:05 AM" },
      { role: "tech", text: "What torque spec for the bearing cap?", ts: "9:08 AM" },
      { role: "mira", text: "Per Air Compressor #1 OEM manual (MC-AC-001, page 47): Bearing cap torque spec is 35 N·m. Apply in cross pattern, re-check after 2 hours of operation.", ts: "9:08 AM" },
      { role: "tech", text: "Got it, I'll lubricate the drive-end bearing now", ts: "9:12 AM" },
    ],
  },
  {
    id: "c002", tech: "Maria Garcia", techInitials: "MG",
    channel: "Telegram", channelEmoji: "✈️",
    lastMessage: "MIRA: CB-3 belt tension spec: 45-50 N/m at ambient temperature...",
    ts: "8:47 AM", asset: "Conveyor Belt #3", unread: 0,
    messages: [
      { role: "tech", text: "What's the correct belt tension for CB3?", ts: "8:47 AM" },
      { role: "mira", text: "CB-3 belt tension spec: 45-50 N/m at ambient temperature. Measure at center span with tension gauge. Adjust via take-up roller. Re-check after 4h of operation. Reference: CB-3 Manual p.23.", ts: "8:47 AM" },
    ],
  },
  {
    id: "c003", tech: "Ray Patel", techInitials: "RP",
    channel: "Email", channelEmoji: "📧",
    lastMessage: "SKF 7020 bearing: 2 units in stock at location B-1-4...",
    ts: "6:58 AM", asset: "CNC Mill #7", unread: 1,
    messages: [
      { role: "tech", text: "Do we have the SKF 7020 bearing in stock for the CNC mill?", ts: "6:58 AM" },
      { role: "mira", text: "SKF 7020 bearing: 2 units in stock at location B-1-4. Part number P-012. Last restocked March 12. Unit cost $187. Reserve via CMMS to avoid stock-out.", ts: "6:58 AM" },
    ],
  },
  {
    id: "c004", tech: "Sam Torres", techInitials: "ST",
    channel: "WhatsApp", channelEmoji: "💬",
    lastMessage: "Welcome Sam! I'm MIRA, your maintenance AI...",
    ts: "Yesterday", asset: null, unread: 0,
    messages: [
      { role: "tech", text: "Hey, this is Sam Torres, starting on the maintenance team today", ts: "Yesterday 4:12 PM" },
      { role: "mira", text: "Welcome Sam! I'm MIRA, your maintenance AI. Send me photos of equipment problems, ask about procedures, or say 'help' to see what I can do. I'm connected to your facility's assets and manuals.", ts: "Yesterday 4:12 PM" },
      { role: "tech", text: "What machines do we have in Building A?", ts: "Yesterday 4:14 PM" },
      { role: "mira", text: "Building A assets: Air Compressor #1 (MC-AC-001, Operational), Conveyor Belt #3 (MC-CB-003, Needs Attention). I can pull specs, maintenance history, or troubleshoot any of these. What do you need?", ts: "Yesterday 4:14 PM" },
    ],
  },
  {
    id: "c005", tech: "Mike Harper", techInitials: "MH",
    channel: "Open WebUI", channelEmoji: "🖥️",
    lastMessage: "Show me the weekly wrench time breakdown by tech",
    ts: "Yesterday", asset: null, unread: 0,
    messages: [
      { role: "tech", text: "Show me the weekly wrench time breakdown by tech", ts: "Yesterday 2:30 PM" },
      { role: "mira", text: "Weekly wrench time by tech: John Smith 72%, Maria Garcia 68%, Ray Patel 65%, Sam Torres 61% (first week). Team average: 67%. Industry benchmark: 60-65%. Your team is above benchmark. Wrench time report available in the Reports section.", ts: "Yesterday 2:30 PM" },
    ],
  },
];

export default function ConversationsPage() {
  const t = useTranslations("conversations");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Conversation | null>(null);

  const filtered = CONVERSATIONS.filter(c =>
    search === "" ||
    c.tech.toLowerCase().includes(search.toLowerCase()) ||
    (c.asset?.toLowerCase().includes(search.toLowerCase()) ?? false) ||
    c.lastMessage.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            {CONVERSATIONS.length} {t("threads")} · {t("allChannels")}
          </p>
        </div>
        <div className="px-4 md:px-6 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t("search")}
              className="w-full h-9 pl-9 pr-3 rounded-lg border text-sm"
              style={{
                backgroundColor: "var(--surface-1)",
                borderColor: "var(--border)",
                color: "var(--foreground)",
              }}
            />
          </div>
        </div>
      </div>

      <div className="pb-24">
        {filtered.map(conv => (
          <button key={conv.id} onClick={() => setSelected(conv)}
            className="w-full text-left flex items-center gap-3 px-4 md:px-6 py-3 border-b hover:bg-[var(--surface-1)] transition-colors"
            style={{ borderColor: "var(--border)" }}>
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                {conv.techInitials}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 text-xs leading-none">
                {conv.channelEmoji}
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{conv.tech}</span>
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{conv.ts}</span>
              </div>
              {conv.asset && (
                <span className="text-[11px] font-medium" style={{ color: "var(--brand-blue)" }}>{conv.asset} ·{" "}</span>
              )}
              <span className="text-xs line-clamp-1" style={{ color: "var(--foreground-muted)" }}>{conv.lastMessage}</span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {conv.unread > 0 && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: "var(--brand-blue)" }}>
                  {conv.unread}
                </span>
              )}
              <ChevronRight className="w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            </div>
          </button>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <MessageSquare className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noConversations")}</p>
          </div>
        )}
      </div>

      {selected && (
        <ConversationThread conv={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function ConversationThread({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const t = useTranslations("conversations");

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ backgroundColor: "var(--surface-0)", borderLeft: "1px solid var(--border)" }}>

        {/* Thread header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="relative flex-shrink-0">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
              {conv.techInitials}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 text-xs">{conv.channelEmoji}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{conv.tech}</p>
            <p className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
              {conv.channel}{conv.asset ? ` · ${conv.asset}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[var(--surface-1)]">
            <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {conv.messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "tech" ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[85%]">
                {msg.role === "mira" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold"
                      style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                      M
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: "var(--brand-blue)" }}>MIRA</span>
                    <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{msg.ts}</span>
                  </div>
                )}
                <div className="rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={msg.role === "tech"
                    ? { backgroundColor: "var(--brand-blue)", color: "white", borderBottomRightRadius: 4 }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground)", borderBottomLeftRadius: 4 }}>
                  {msg.text}
                </div>
                {msg.role === "tech" && (
                  <p className="text-[10px] text-right mt-0.5" style={{ color: "var(--foreground-subtle)" }}>{msg.ts}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Read-only notice */}
        <div className="px-4 py-3 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-2 text-xs rounded-lg px-3 py-2"
            style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>
            <Send className="w-3.5 h-3.5 flex-shrink-0" />
            {t("readOnly")}
          </div>
        </div>
      </div>
    </>
  );
}
