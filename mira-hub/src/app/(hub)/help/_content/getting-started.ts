export type Step = {
  number: number;
  title: string;
  body: string;
  tip?: string;
};

export const GETTING_STARTED_STEPS: Step[] = [
  {
    number: 1,
    title: "Log in",
    body:
      "Open the email we sent you and tap the magic link. That signs you in. No password to remember. If you'd rather use Google, tap **Continue with Google** on the login screen.",
    tip: "On a phone? Add MIRA to your home screen so it opens like a native app. Safari: Share → Add to Home Screen. Chrome: three-dot menu → Install app.",
  },
  {
    number: 2,
    title: "Add your first asset",
    body:
      "An asset is any machine you maintain. Two ways to add one. **Scan a QR sticker** with your phone camera if your equipment is already tagged. Or tap **+ New Asset** in the Assets screen and type the vendor and model. MIRA pulls the manual for you in the background.",
    tip: "If you don't have QR stickers yet, that's fine. You can print and attach them later from Assets → Print QR.",
  },
  {
    number: 3,
    title: "Create a work order",
    body:
      "From any asset page, tap **Create work order**. Type what's wrong in plain words — for example: *\"Belt squeals on startup, third time this month.\"* Pick a priority. Assign it to yourself or a teammate. Done.",
    tip: "Every chat with MIRA can become a work order with one tap. Look for the **Save as work order** button at the end of a diagnosis.",
  },
  {
    number: 4,
    title: "Ask MIRA a question",
    body:
      "Type into the chat box on the home screen, or message **@MiraFactoryBot** on Telegram. Try things like:\n\n- *\"My Yaskawa GS20 is faulting on F030\"*\n- *\"What lubrication does motor 12 take?\"*\n- *\"How do I lock out the press at line 4?\"*\n\nMIRA reads your manuals, your work-order history, and your safety procedures. It cites the page it pulled from so you can double-check.",
    tip: "MIRA works on Slack, Teams, and WhatsApp too. Connect them under **Channels** in the sidebar.",
  },
  {
    number: 5,
    title: "View your PM schedule",
    body:
      "Tap **Schedule** in the sidebar. Your planned maintenance is sorted by due date. Tap any item to see its checklist and start it. When you're done, MIRA logs the closeout in your CMMS.",
    tip: "Overdue PMs show in red. Get them visible to your team by sharing the Schedule page link.",
  },
];

export const GETTING_STARTED_NEXT = [
  { label: "Browse feature guides", href: "/help/features" },
  { label: "Read the FAQ", href: "/help/faq" },
  { label: "Contact support", href: "/help/contact" },
];
