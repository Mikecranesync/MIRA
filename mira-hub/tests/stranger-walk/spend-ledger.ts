/**
 * The cross-run spend cap (#5081). BudgetMeter caps ONE process at MAX_USD_PER_RUN; the owner's cap
 * is a campaign TOTAL across every run, restart and lane (Mike 2026-11-01: $11.52, never reset). That
 * total lives as append-only `[WALK-SPEND]` comments on one GitHub issue (spend-ledger.json), read
 * the same way required-fixes.ts reads GitHub, so it works from a laptop walk and from CI alike.
 *
 * Counting: an entry_id's `settle` replaces its `reservation`; a reservation with no settle (a run
 * that crashed) stays fully counted; every `external` (a paid check outside the harness) counts.
 * Fails closed: a malformed entry, a duplicate, a settle without a reservation, or an unreadable
 * ledger refuses to start. A reservation that a concurrent one pushed over the cap (earlier comment
 * id wins) is settled at $0 and refused.
 */
import ledgerJson from "./spend-ledger.json";

export type Campaign = { campaign: string; capUsd: number; issue: number; authors: string[] };
export type Kind = "reservation" | "settle" | "external";
export type Entry = { commentId: number; entryId: string; kind: Kind; usd: number; note: string };
export type Comment = { id: number; user: { login: string } | null; body: string; html_url?: string };
export type Tally = { totalUsd: number; entries: Entry[]; problems: string[] };

export const CAMPAIGN: Campaign = ledgerJson as Campaign;
export const MARKER = "[WALK-SPEND]";
const KINDS: readonly Kind[] = ["reservation", "settle", "external"];
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const ENTRY_ID = /^[A-Za-z0-9._:-]{1,80}$/;
/** Checked BEFORE anything is posted: a malformed entry would block every later walk. */
function assertWritable(entryId: string, usd: number): void {
  if (!ENTRY_ID.test(entryId)) throw new Error(`bad entry_id "${entryId}"`);
  if (!Number.isFinite(usd) || usd < 0 || usd > 9999) throw new Error(`bad usd ${usd}`);
}

/** One comment → an entry, a problem, or null (not an entry of this campaign). */
export function parseEntry(c: Comment, campaign: Campaign): Entry | string | null {
  const body = c.body.replace(/\r\n/g, "\n").trim();
  if (!body.startsWith(MARKER)) return null;
  if (!c.user || !campaign.authors.includes(c.user.login)) return null; // not a trusted writer
  const kv = new Map<string, string>();
  for (const line of body.split("\n").slice(1)) {
    if (!line.trim() || line.trim().startsWith("```")) continue;
    const m = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
    if (!m) return `comment ${c.id}: unreadable line "${line.trim().slice(0, 60)}"`;
    if (kv.has(m[1])) return `comment ${c.id}: duplicate key ${m[1]}`;
    kv.set(m[1], m[2].trim());
  }
  if (kv.get("campaign") !== campaign.campaign) return kv.has("campaign") ? null : `comment ${c.id}: no campaign`;
  const entryId = kv.get("entry_id") ?? "";
  const kind = kv.get("kind") as Kind;
  const usdRaw = kv.get("usd") ?? "";
  if (!ENTRY_ID.test(entryId)) return `comment ${c.id}: bad entry_id "${entryId}"`;
  if (!KINDS.includes(kind)) return `comment ${c.id}: bad kind "${String(kind)}"`;
  if (!/^\d{1,4}(\.\d{1,6})?$/.test(usdRaw)) return `comment ${c.id}: bad usd "${usdRaw}"`;
  return { commentId: c.id, entryId, kind, usd: Number(usdRaw), note: kv.get("note") ?? "" };
}

/** The campaign total from every comment. `upTo` counts only entries posted at or before that
 *  comment id (the race check); settles always apply to the reservation they close. */
export function tally(comments: Comment[], campaign: Campaign = CAMPAIGN, upTo = Infinity): Tally {
  const entries: Entry[] = [];
  const problems: string[] = [];
  for (const c of [...comments].sort((a, b) => a.id - b.id)) {
    const e = parseEntry(c, campaign);
    if (typeof e === "string") problems.push(e);
    else if (e) entries.push(e);
  }
  const byId = new Map<string, { reservation?: Entry; settle?: Entry; external?: Entry }>();
  for (const e of entries) {
    const slot = byId.get(e.entryId) ?? {};
    if (slot[e.kind]) problems.push(`entry ${e.entryId}: duplicate ${e.kind}`);
    if (e.kind === "external" && (slot.reservation || slot.settle)) problems.push(`entry ${e.entryId}: external reuses a run id`);
    if (e.kind !== "external" && slot.external) problems.push(`entry ${e.entryId}: run id reuses an external id`);
    slot[e.kind] ??= e;
    byId.set(e.entryId, slot);
  }
  let total = 0;
  for (const [id, s] of byId) {
    if (s.settle && !s.reservation) { problems.push(`entry ${id}: settle without a reservation`); continue; }
    const head = s.reservation ?? s.external!;
    if (head.commentId > upTo) continue;
    total += s.settle ? s.settle.usd : head.usd;
  }
  return { totalUsd: round6(total), entries, problems };
}

export function entryBody(campaign: Campaign, entryId: string, kind: Kind, usd: number, note: string): string {
  const safeNote = note.replace(/[\r\n]+/g, " ").slice(0, 300);
  return [MARKER, `campaign: ${campaign.campaign}`, `entry_id: ${entryId}`, `kind: ${kind}`, `usd: ${round6(usd).toFixed(6)}`, `note: ${safeNote}`].join("\n");
}

type Gh = { token: string | null; repo?: string; fetchImpl?: typeof fetch; campaign?: Campaign };

function client(o: Gh) {
  const f = o.fetchImpl ?? fetch;
  const campaign = o.campaign ?? CAMPAIGN;
  const url = `https://api.github.com/repos/${o.repo || "Mikecranesync/MIRA"}/issues/${campaign.issue}/comments`;
  const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${o.token}`, "X-GitHub-Api-Version": "2022-11-28" };
  return {
    campaign,
    async read(): Promise<Comment[]> {
      if (!o.token) throw new Error("no GitHub token — cannot read the spend ledger");
      const all: Comment[] = [];
      for (let page = 1; page <= 50; page++) {
        const res = await f(`${url}?per_page=100&page=${page}`, { headers });
        if (!res.ok) throw new Error(`spend ledger read ${res.status}`);
        const batch = (await res.json()) as Comment[];
        all.push(...batch);
        if (batch.length < 100) return all;
      }
      throw new Error("spend ledger has more than 5000 comments — refusing to guess the total");
    },
    async post(body: string): Promise<Comment> {
      const res = await f(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
      if (!res.ok) throw new Error(`spend ledger write ${res.status}`);
      return (await res.json()) as Comment;
    },
  };
}

export type Reservation = { ok: true; entryId: string; reservedUsd: number; totalUsd: number; capUsd: number; commentId: number } | { ok: false; reason: string };

/** Book `usd` against the campaign before the first paid turn. Refuses (and spends nothing) when
 *  the ledger is unreadable or malformed, or when the total plus `usd` would pass the cap. */
export async function reserveWalkSpend(o: Gh & { entryId: string; usd: number; note: string }): Promise<Reservation> {
  const gh = client(o);
  const { campaign } = gh;
  try {
    assertWritable(o.entryId, o.usd);
    const before = tally(await gh.read(), campaign);
    if (before.problems.length) return { ok: false, reason: `spend ledger #${campaign.issue} is malformed: ${before.problems.join("; ")}` };
    if (before.entries.some((e) => e.entryId === o.entryId)) return { ok: false, reason: `entry ${o.entryId} already in the ledger` };
    if (before.totalUsd + o.usd > campaign.capUsd + 1e-9) {
      return { ok: false, reason: `campaign ${campaign.campaign}: $${before.totalUsd.toFixed(4)} booked + $${o.usd.toFixed(4)} reservation would pass the $${campaign.capUsd.toFixed(2)} cap` };
    }
    const mine = await gh.post(entryBody(campaign, o.entryId, "reservation", o.usd, o.note));
    // Race check: entries posted before ours (lower ids) win; if they push ours over, release it.
    const after = tally(await gh.read(), campaign, mine.id);
    if (!after.entries.some((e) => e.commentId === mine.id)) return { ok: false, reason: `reservation comment ${mine.id} not found on re-read — not booked` };
    if (after.problems.length || after.totalUsd > campaign.capUsd + 1e-9) {
      await gh.post(entryBody(campaign, o.entryId, "settle", 0, "released: a concurrent reservation reached the cap first")).catch(() => undefined);
      return { ok: false, reason: `campaign ${campaign.campaign}: a concurrent reservation reached the cap first ($${after.totalUsd.toFixed(4)} with ours) — released` };
    }
    return { ok: true, entryId: o.entryId, reservedUsd: o.usd, totalUsd: after.totalUsd, capUsd: campaign.capUsd, commentId: mine.id };
  } catch (e) {
    return { ok: false, reason: `spend ledger: ${(e as Error).message}` };
  }
}

/** Close a reservation at the run's booked spend. Never above the reservation: the meter cannot
 *  book past it, so a larger value is a bug and stays at the (already counted) reservation. */
export async function settleWalkSpend(o: Gh & { entryId: string; reservedUsd: number; bookedUsd: number; note: string }): Promise<string> {
  const gh = client(o);
  const usd = Math.min(Math.max(0, o.bookedUsd), o.reservedUsd);
  assertWritable(o.entryId, usd);
  const c = await gh.post(entryBody(gh.campaign, o.entryId, "settle", usd, o.note));
  return c.html_url ?? `comment ${c.id}`;
}

/** Book a paid check made outside the harness (a phone question, a manual probe). */
export async function bookExternalSpend(o: Gh & { entryId: string; usd: number; note: string }): Promise<string> {
  assertWritable(o.entryId, o.usd);
  const gh = client(o);
  const before = tally(await gh.read(), gh.campaign);
  if (before.problems.length) throw new Error(`spend ledger #${gh.campaign.issue} is malformed: ${before.problems.join("; ")}`);
  if (before.entries.some((e) => e.entryId === o.entryId)) throw new Error(`entry ${o.entryId} already in the ledger`);
  const c = await gh.post(entryBody(gh.campaign, o.entryId, "external", o.usd, o.note));
  return c.html_url ?? `comment ${c.id}`;
}

/** Read-only: the campaign's current total. */
export async function campaignTotal(o: Gh): Promise<Tally & { capUsd: number }> {
  const gh = client(o);
  return { ...tally(await gh.read(), gh.campaign), capUsd: gh.campaign.capUsd };
}
