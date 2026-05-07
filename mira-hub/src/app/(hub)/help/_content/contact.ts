export type ContactChannel = {
  icon: string;
  title: string;
  detail: string;
  href?: string;
  responseTime: string;
};

export const CONTACT_CHANNELS: ContactChannel[] = [
  {
    icon: "Mail",
    title: "Email",
    detail: "mike@cranesync.com",
    href: "mailto:mike@cranesync.com",
    responseTime: "Replies within 1 business day",
  },
  {
    icon: "Send",
    title: "Telegram",
    detail: "@MiraFactorySupport",
    href: "https://t.me/MiraFactorySupport",
    responseTime: "Same-day during US business hours",
  },
  {
    icon: "Bug",
    title: "Bug report",
    detail: "Open a GitHub issue",
    href: "https://github.com/Mikecranesync/MIRA/issues/new",
    responseTime: "Acknowledged within 48 hours",
  },
  {
    icon: "DollarSign",
    title: "Sales / pricing",
    detail: "mike@cranesync.com",
    href: "mailto:mike@cranesync.com?subject=FactoryLM%20pricing",
    responseTime: "Same-day during US business hours",
  },
];

export const SUPPORT_HOURS =
  "Support runs on US Eastern time, Monday through Friday, 8 AM to 6 PM. Outside those hours we're slower but we still respond.";

export const ESCALATION =
  "If a machine is down and you need help fast, message Telegram or email with the subject line **URGENT — machine down**. We push these to the top of the queue.";
