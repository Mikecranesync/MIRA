/**
 * Read live blog drafts from NeonDB blog_drafts table.
 * Merges with static seed data in server.ts.
 * Cache with 5-minute TTL to avoid hitting the DB on every request.
 */

import { neon } from "@neondatabase/serverless";
import type { FaultCode } from "../data/fault-codes.js";
import type { BlogPost } from "../data/blog-posts.js";

const DB_URL = process.env.NEON_DATABASE_URL || "";

interface CacheEntry<T> {
  data: T[];
  fetchedAt: number;
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes
let faultCodeCache: CacheEntry<FaultCode> | null = null;
let blogPostCache: CacheEntry<BlogPost> | null = null;

function isFresh<T>(cache: CacheEntry<T> | null): cache is CacheEntry<T> {
  return cache !== null && Date.now() - cache.fetchedAt < TTL_MS;
}

/**
 * Return true if a NeonDB error is "relation does not exist" (Postgres SQLSTATE 42P01).
 * The blog_drafts table is provisioned only after the editorial workflow ships;
 * until then, a missing-table error is expected and not worth logging.
 */
function isUndefinedTableError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const msg = String((e as { message?: unknown }).message ?? "");
  const code = String((e as { code?: unknown }).code ?? "");
  return code === "42P01" || /relation\s+"?blog_drafts"?\s+does not exist/i.test(msg);
}

export async function getLiveFaultCodes(): Promise<FaultCode[]> {
  if (isFresh(faultCodeCache)) return faultCodeCache.data;

  if (!DB_URL) return [];

  try {
    const sql = neon(DB_URL);
    const rows = await sql`
      SELECT content_json FROM blog_drafts
      WHERE draft_type = 'fault_code' AND status = 'live'
      ORDER BY published_at DESC
    `;

    const codes: FaultCode[] = rows.map((r) => {
      const j = typeof r.content_json === "string" ? JSON.parse(r.content_json) : r.content_json;
      return {
        slug: j.slug ?? "",
        title: j.title ?? "",
        equipment: j.equipment ?? "",
        manufacturer: j.manufacturer ?? "",
        faultCode: j.faultCode ?? "",
        description: j.description ?? "",
        commonCauses: j.commonCauses ?? [],
        recommendedFix: j.recommendedFix ?? "",
        relatedCodes: j.relatedCodes ?? [],
        metaDescription: j.metaDescription ?? "",
      };
    });

    faultCodeCache = { data: codes, fetchedAt: Date.now() };
    return codes;
  } catch (e) {
    if (isUndefinedTableError(e)) {
      // Expected pre-launch — table not created yet. Cache the empty result so
      // we don't re-query for TTL_MS and re-spam the log.
      faultCodeCache = { data: [], fetchedAt: Date.now() };
      return [];
    }
    console.error("[blog-db] Failed to fetch live fault codes:", e);
    return faultCodeCache?.data ?? [];
  }
}

export async function getLiveBlogPosts(): Promise<BlogPost[]> {
  if (isFresh(blogPostCache)) return blogPostCache.data;

  if (!DB_URL) return [];

  try {
    const sql = neon(DB_URL);
    const rows = await sql`
      SELECT content_json FROM blog_drafts
      WHERE draft_type = 'article' AND status = 'live'
      ORDER BY published_at DESC
    `;

    const posts: BlogPost[] = rows.map((r) => {
      const j = typeof r.content_json === "string" ? JSON.parse(r.content_json) : r.content_json;
      return {
        slug: j.slug ?? "",
        title: j.title ?? "",
        description: j.description ?? "",
        date: j.date ?? new Date().toISOString().split("T")[0],
        author: j.author ?? "FactoryLM Engineering",
        category: j.category ?? "Guides",
        readingTime: j.readingTime ?? "5 min read",
        heroEmoji: j.heroEmoji ?? "M",
        sections: j.sections ?? [],
        relatedPosts: j.relatedPosts ?? [],
        relatedFaultCodes: j.relatedFaultCodes ?? [],
      };
    });

    blogPostCache = { data: posts, fetchedAt: Date.now() };
    return posts;
  } catch (e) {
    if (isUndefinedTableError(e)) {
      blogPostCache = { data: [], fetchedAt: Date.now() };
      return [];
    }
    console.error("[blog-db] Failed to fetch live blog posts:", e);
    return blogPostCache?.data ?? [];
  }
}

/** Force cache refresh (called by the refresh interval). */
export function invalidateCache(): void {
  faultCodeCache = null;
  blogPostCache = null;
}
