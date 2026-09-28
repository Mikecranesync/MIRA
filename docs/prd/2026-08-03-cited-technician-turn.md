# PRD — Cited Technician Turn

- **Status:** DRAFT — recommendation for product review. This document authorizes no production traffic, deployment, provider change, or control write.
- **Date:** 2026-08-03
- **Owner:** Mike Harper
- **Product area:** MIRA technician experience
- **Scope classification:** Core SaaS — grounded maintenance copilot, not generic chat
- **Repository snapshot:** reviewed against <code>origin/main</code> at <code>cde434b9</code>
- **Decision:** Every MIRA answer should be a short, context-bound, cited technician turn: what MIRA knows, the evidence it used, the next safe check, and the one action that moves the job forward.

## 1. Executive summary

MIRA should borrow the interaction discipline of the best chat products without copying a generic-chat product surface.

The recommended product is the **Cited Technician Turn**: a mobile-first response that makes a technician's current asset context, evidence, uncertainty, safety status, and next action visible in one compact unit. It converts chat from a scrolling transcript into a reliable maintenance interaction:

1. identify or certify the asset context;
2. answer directly when cited evidence supports an answer;
3. ask one bounded question only when context or evidence is missing;
4. stop and escalate when the safety policy fires; and
5. preserve a reviewable evidence trail for a supervisor, work order, or later return to the job.

This is deliberately narrower than a ChatGPT clone. MIRA does not need arbitrary projects, a general-purpose canvas, web browsing, long-form content generation, or a separate conversational brain. Its differentiator is a correctly scoped, evidence-backed answer at the machine.

