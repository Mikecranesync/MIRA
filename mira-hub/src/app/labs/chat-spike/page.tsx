import { notFound } from "next/navigation";
import { ChatSpike } from "./ChatSpike";

/**
 * ChatGPT-class UI compatibility spike (PRD §8.3, ADR-0038/0039).
 * Dev-only lab page — NEVER ships: production builds 404 it. No nav links.
 */
export default function ChatSpikePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ChatSpike />;
}
