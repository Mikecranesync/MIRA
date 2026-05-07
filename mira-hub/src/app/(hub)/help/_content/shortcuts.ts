export type Shortcut = {
  keys: string[];
  action: string;
};

export type ShortcutGroup = {
  group: string;
  shortcuts: Shortcut[];
};

export const SHORTCUTS: ShortcutGroup[] = [
  {
    group: "Navigation",
    shortcuts: [
      { keys: ["g", "f"], action: "Go to Activity Feed" },
      { keys: ["g", "a"], action: "Go to Assets" },
      { keys: ["g", "w"], action: "Go to Work Orders" },
      { keys: ["g", "s"], action: "Go to PM Schedule" },
      { keys: ["g", "k"], action: "Go to Knowledge Base" },
      { keys: ["g", "h"], action: "Go to Help" },
    ],
  },
  {
    group: "Actions",
    shortcuts: [
      { keys: ["c"], action: "Create new (work order or asset, depending on the page)" },
      { keys: ["/"], action: "Focus the search box" },
      { keys: ["?"], action: "Open keyboard shortcuts (this page)" },
      { keys: ["Esc"], action: "Close any open modal or drawer" },
    ],
  },
  {
    group: "Chat",
    shortcuts: [
      { keys: ["⏎"], action: "Send the message" },
      { keys: ["⇧", "⏎"], action: "New line in the message" },
      { keys: ["⌘", "K"], action: "Start a new chat" },
    ],
  },
];

export const TIPS: { title: string; body: string }[] = [
  {
    title: "Voice on mobile",
    body: "Tap the mic icon in the chat bar. Talk normally — MIRA transcribes and answers. Works hands-free with a wired headset.",
  },
  {
    title: "Pin frequent assets",
    body: "Long-press any asset in the Assets list to pin it to the top. Useful for the machines you touch every day.",
  },
  {
    title: "Use Telegram for quick questions",
    body: "Message @MiraFactoryBot on Telegram. Same brain as the web app, but faster to open from a locked phone.",
  },
  {
    title: "Drag PDFs into chat",
    body: "Drop a PDF directly into the chat box. MIRA reads it on the fly and answers questions about that specific document.",
  },
];
