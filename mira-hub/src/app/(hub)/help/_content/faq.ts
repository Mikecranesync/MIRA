export type FaqItem = {
  q: string;
  a: string;
};

export const FAQ: FaqItem[] = [
  {
    q: "How does MIRA learn about my equipment?",
    a: "Three ways. First, MIRA ships with 25,000+ chunks of common OEM manuals already loaded. Second, when you add an asset, MIRA pulls the official manual for that vendor and model. Third, you upload your own — drag a PDF into Knowledge Base. MIRA reads it and starts citing the right pages.",
  },
  {
    q: "Can I use MIRA from my phone?",
    a: "Yes. Open app.factorylm.com in Safari (iOS) or Chrome (Android). For the best experience, add it to your home screen — Share → Add to Home Screen on iOS, or three-dot menu → Install app on Android. It opens full-screen like a native app.",
  },
  {
    q: "How does the Knowledge Cooperative work?",
    a: "The Knowledge Cooperative is shared, anonymized fixes. When a tech at one plant resolves a fault, MIRA can learn from that fix and use it to help techs at other plants — *with the names, locations, and identifying details stripped out*. You opt in. Your raw data, manuals, and chats stay yours and never get shared.",
  },
  {
    q: "What CMMS systems does FactoryLM integrate with?",
    a: "Atlas (built into FactoryLM, no setup needed), MaintainX, Limble, and Fiix today. We add new connectors based on customer demand — email mike@cranesync.com if yours isn't on the list.",
  },
  {
    q: "How do I export my data?",
    a: "Settings → Export. You get a ZIP of every asset, work order, chat, and uploaded document. We also support a daily backup to your own S3 bucket on the Pro plan and above.",
  },
  {
    q: "Is my data secure?",
    a: "TLS 1.3 in transit, AES-256 at rest. Your account is isolated from every other tenant. We never train shared models on your raw text. Single sign-on (Google Workspace, Microsoft, Okta) is supported on the Team plan and above. SOC 2 Type II is in progress — see our security page for the latest.",
  },
  {
    q: "What happens if MIRA doesn't know the answer?",
    a: "MIRA says so. It won't make things up. If the manuals don't cover what you asked, MIRA tells you and offers to escalate to a senior tech, your OEM, or open a research ticket. You can mark any answer as wrong with one tap, which feeds back into the system.",
  },
  {
    q: "How do I add team members?",
    a: "Team → Invite (or Settings → Team on mobile). Type their email, pick a role — Technician, Manager, Admin, Owner — and send. They get an email link, click it, and they're in. No password to set up if they sign in with Google.",
  },
  {
    q: "What's included in each pricing tier?",
    a: "Starter ($97/mo): 1 plant, 5 users, unlimited chats, all CMMS connectors. Team ($297/mo): 3 plants, 25 users, SSO, priority support. Pro (call us): unlimited plants, unlimited users, custom training, dedicated success manager. Full pricing at factorylm.com/pricing.",
  },
  {
    q: "How do I contact support?",
    a: "Email mike@cranesync.com — replies within 1 business day. Telegram @MiraFactorySupport — same-day during US business hours. For bugs, open a GitHub issue. For \"how do I…\" questions, the help section you're reading right now is the fastest path.",
  },
];
