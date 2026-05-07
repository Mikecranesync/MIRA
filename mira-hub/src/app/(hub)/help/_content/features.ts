export type FeatureGuide = {
  slug: string;
  title: string;
  icon: string;
  oneLiner: string;
  whatItDoes: string;
  howToUse: { step: string; body: string }[];
  questions: { q: string; a: string }[];
  related: { label: string; href: string }[];
};

export const FEATURES: FeatureGuide[] = [
  {
    slug: "feed",
    title: "Activity Feed",
    icon: "Activity",
    oneLiner: "What changed in your plant today, in one stream.",
    whatItDoes:
      "The Feed is the front page of your plant. It shows new work orders, finished repairs, MIRA diagnoses, alerts, and PMs in one scrollable list. Anyone on your team can drop a note here too.",
    howToUse: [
      { step: "Pull to refresh", body: "On mobile, swipe down. On desktop, the feed updates on its own every minute." },
      { step: "Tap any card", body: "Tap a feed item to jump to the work order, asset, or chat it came from." },
      { step: "Filter by type", body: "Use the chips at the top — All, Work Orders, Diagnoses, Alerts — to narrow what you see." },
      { step: "Post a note", body: "Tap **+** and type a quick update. Useful for shift handoffs and quick wins." },
    ],
    questions: [
      { q: "Can I see only my work?", a: "Yes. Filter by **Mine** in the top chips." },
      { q: "Why don't I see items from another shift?", a: "By default the feed shows the last 24 hours. Tap **Older** at the bottom to scroll back further." },
    ],
    related: [
      { label: "Work Orders", href: "/help/features/workorders" },
      { label: "Alerts", href: "/help/features/feed" },
    ],
  },
  {
    slug: "assets",
    title: "Assets",
    icon: "Wrench",
    oneLiner: "Every machine, every QR sticker, every manual.",
    whatItDoes:
      "Assets is the registry of every machine you take care of. Each asset has a vendor, model, location, photo, manual, and history. MIRA uses this profile to give you better answers.",
    howToUse: [
      { step: "Add an asset", body: "Tap **+ New Asset**. Type the vendor and model. MIRA pulls the manual." },
      { step: "Scan to find one fast", body: "Open the camera, point at a QR sticker. The asset opens, scoped to that machine." },
      { step: "Print QR stickers", body: "From any asset, tap **Print QR**. Or do a batch print under Assets → Print QR." },
      { step: "Upload a manual", body: "Tap an asset, then **Upload manual**. Drag in a PDF. MIRA reads it in the background — usually 2 to 10 minutes." },
    ],
    questions: [
      { q: "What if MIRA doesn't have my vendor?", a: "Add it manually. The asset still works for chat, work orders, and PMs. Upload your manual and MIRA learns it." },
      { q: "Can I bulk-import assets?", a: "Yes. Settings → Import → CSV. We have a template." },
    ],
    related: [
      { label: "MIRA Scan", href: "/help/features/scan" },
      { label: "Knowledge Base", href: "/help/features/knowledge" },
    ],
  },
  {
    slug: "workorders",
    title: "Work Orders",
    icon: "ClipboardList",
    oneLiner: "Track repairs from request to closeout.",
    whatItDoes:
      "Work orders are how repairs and tasks get tracked. Open one, do the work, close it out. If you connect a CMMS like MaintainX or Limble, work orders sync both ways.",
    howToUse: [
      { step: "Create one", body: "From an asset, a chat, or the Work Orders page. Type a title, pick priority, assign someone." },
      { step: "Update status", body: "Tap the status chip — New, Open, In Progress, Done. Anyone on the team can update." },
      { step: "Add photos and notes", body: "Drop in before/after photos. MIRA can summarize the chat that led to the work order." },
      { step: "Close it out", body: "Tap **Close out**. MIRA drafts a summary you can edit. Saves to your CMMS automatically." },
    ],
    questions: [
      { q: "Can I bulk-close work orders?", a: "Yes. Select multiples on the Work Orders page, tap **Close out selected**." },
      { q: "Where do work orders go after closeout?", a: "Stays in MIRA forever. Also lands in your CMMS if you've connected one." },
    ],
    related: [
      { label: "PM Schedule", href: "/help/features/schedule" },
      { label: "CMMS Integration", href: "/help/features/cmms" },
    ],
  },
  {
    slug: "schedule",
    title: "PM Schedule",
    icon: "CalendarDays",
    oneLiner: "Never miss a planned maintenance again.",
    whatItDoes:
      "The Schedule shows every PM (planned maintenance) by due date. Overdue items are red. Tap any to see the checklist and start it. When you're done, MIRA closes it in your CMMS.",
    howToUse: [
      { step: "See what's due", body: "Open Schedule. Today is at the top. Overdue is red." },
      { step: "Start a PM", body: "Tap an item. Walk through the checklist. Check items off as you go." },
      { step: "Add a PM", body: "Tap **+ New PM**. Pick the asset, the interval (weekly, monthly, quarterly, etc.), and the checklist." },
      { step: "Reassign", body: "Long-press a PM to reassign it to a teammate." },
    ],
    questions: [
      { q: "Can I import PMs from my CMMS?", a: "Yes. When you connect MaintainX, Limble, or Fiix, PMs sync over." },
      { q: "Do I get reminders?", a: "Yes. Set notifications under Settings → Notifications. Email, push, or both." },
    ],
    related: [
      { label: "Work Orders", href: "/help/features/workorders" },
      { label: "CMMS Integration", href: "/help/features/cmms" },
    ],
  },
  {
    slug: "knowledge",
    title: "Knowledge Base",
    icon: "BookOpen",
    oneLiner: "Upload manuals. MIRA reads them so you don't have to.",
    whatItDoes:
      "The Knowledge Base is where every manual, fault-code chart, and SOP lives. MIRA reads them and cites the right page when you ask a question.",
    howToUse: [
      { step: "Upload a PDF", body: "Tap **Upload PDF**. Drag a file in. Up to 200 MB." },
      { step: "Wait for processing", body: "MIRA reads the manual in the background. Usually 2 to 10 minutes for a 300-page PDF. You'll see a green check when it's ready." },
      { step: "Tag it to an asset", body: "After upload, link the manual to the assets it covers. That makes MIRA's answers more accurate." },
      { step: "Search", body: "Type any term in the search bar. MIRA finds the page and shows you a snippet." },
    ],
    questions: [
      { q: "What file types work?", a: "PDF and image files. Scanned PDFs are OCR'd automatically." },
      { q: "Are my manuals shared with other plants?", a: "No. Your uploads are yours. Only the *anonymized* fixes you opt in to (Knowledge Cooperative) ever leave your account." },
    ],
    related: [
      { label: "Assets", href: "/help/features/assets" },
      { label: "FAQ — Knowledge Cooperative", href: "/help/faq" },
    ],
  },
  {
    slug: "cmms",
    title: "CMMS Integration",
    icon: "Plug",
    oneLiner: "Connect MaintainX, Limble, Fiix, or Atlas.",
    whatItDoes:
      "Sync work orders, assets, and PMs both ways with your existing CMMS. MIRA closes out work orders for you. Your team keeps using the CMMS they already know.",
    howToUse: [
      { step: "Open Integrations", body: "Sidebar → Integrations." },
      { step: "Pick your CMMS", body: "MaintainX, Limble, Fiix, or Atlas. Tap **Connect**." },
      { step: "Authorize", body: "You'll be sent to your CMMS to approve. Takes 30 seconds." },
      { step: "Pick what syncs", body: "Choose what flows between systems — assets, PMs, work orders. You can change this later." },
    ],
    questions: [
      { q: "What if my CMMS isn't on the list?", a: "Email mike@cranesync.com — we add new connectors based on demand." },
      { q: "Will it overwrite my existing data?", a: "No. First sync is read-only. You opt in before any writes go to your CMMS." },
    ],
    related: [
      { label: "Work Orders", href: "/help/features/workorders" },
      { label: "PM Schedule", href: "/help/features/schedule" },
    ],
  },
  {
    slug: "scan",
    title: "MIRA Scan",
    icon: "Radio",
    oneLiner: "Point your phone at a machine. Get answers.",
    whatItDoes:
      "Scan opens a chat that's already pre-loaded with the machine's vendor, model, history, and recent faults. No typing what's broken — MIRA already knows what you're looking at.",
    howToUse: [
      { step: "Open your camera", body: "On any phone, point at the QR sticker on the machine." },
      { step: "Tap the link", body: "MIRA opens straight to that asset's chat." },
      { step: "Talk or type", body: "Hit the mic for voice. Or type. Describe what's wrong, MIRA takes it from there." },
    ],
    questions: [
      { q: "Don't have stickers yet?", a: "Print them from Assets → Print QR. Or use **Open MIRA** in the asset page — same effect." },
      { q: "Does it work offline?", a: "The QR opens MIRA. The chat needs an internet connection." },
    ],
    related: [
      { label: "Assets", href: "/help/features/assets" },
      { label: "Getting Started", href: "/help/getting-started" },
    ],
  },
  {
    slug: "reports",
    title: "Reports",
    icon: "TrendingUp",
    oneLiner: "Wrench time, downtime, MTTR — at a glance.",
    whatItDoes:
      "Reports show how your maintenance team is doing. Wrench time, downtime, mean time to repair, fault patterns. Filter by asset, by tech, by date range.",
    howToUse: [
      { step: "Open Reports", body: "Sidebar → Reports." },
      { step: "Pick a date range", body: "Last 7 days, 30 days, quarter, or custom." },
      { step: "Drill down", body: "Tap any chart to see the underlying work orders." },
      { step: "Export", body: "Tap **Export** for a CSV. Use it in Excel or Google Sheets." },
    ],
    questions: [
      { q: "What is wrench time?", a: "The percent of a tech's shift spent on actual repair work, vs. searching, waiting, or paperwork." },
      { q: "Can I share a report?", a: "Yes. Tap **Share** for a read-only link. Expires in 30 days." },
    ],
    related: [
      { label: "Work Orders", href: "/help/features/workorders" },
    ],
  },
  {
    slug: "settings",
    title: "Settings",
    icon: "Settings",
    oneLiner: "Team, billing, integrations, your profile.",
    whatItDoes:
      "Everything that doesn't fit somewhere else. Manage who's on your team, what you're paying, what's connected, and how MIRA contacts you.",
    howToUse: [
      { step: "Profile", body: "Set your name, photo, and notification preferences." },
      { step: "Team", body: "Invite teammates. Set roles — technician, admin, manager." },
      { step: "Billing", body: "See your plan and invoices. Upgrade or cancel anytime." },
      { step: "Export your data", body: "Settings → Export. ZIP of every asset, work order, and chat." },
    ],
    questions: [
      { q: "What roles are there?", a: "Technician (chat + work orders), Manager (everything plus reports), Admin (everything plus user management), Owner (everything plus billing)." },
      { q: "Can I delete my account?", a: "Yes. Settings → Delete account. We export your data first." },
    ],
    related: [
      { label: "Pricing FAQ", href: "/help/faq" },
      { label: "Contact Support", href: "/help/contact" },
    ],
  },
];

export function getFeature(slug: string): FeatureGuide | undefined {
  return FEATURES.find((f) => f.slug === slug);
}
