import { redirect } from "next/navigation";

// /graph moved into the Knowledge section as the "Map" sub-tab. Permanent
// redirect so existing links resolve — including the reasoning-trace deep
// link /graph?session=… which the Ask MIRA answer view points at.
export default async function GraphRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (typeof value === "string") qs.set(key, value);
    else if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
  }
  const q = qs.toString();
  redirect(`/knowledge/map${q ? `?${q}` : ""}`);
}
