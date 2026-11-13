import { fixedHazardBanners } from "@/lib/safety-classifier";
import { citationPageLabel } from "@/lib/citation-page";

/** #5408: fixed safety guidance is not a claim from a manual. Recognize only
 * exact server banners and their old page-only suffix; leave manual quotations
 * and any additional authored text untouched. Used for new turns and history. */
export function generalSafetyReminder(paragraph: string): string {
  const banner = fixedHazardBanners().find((text) => {
    if (paragraph === text) return true;
    if (!paragraph.startsWith(text)) return false;
    const suffix = /^\s+\(p\.([^)]+)\)$/.exec(paragraph.slice(text.length));
    return suffix !== null && citationPageLabel(suffix[1]) !== null;
  });
  return banner
    ? `${banner} **General safety reminder.**`
    : paragraph;
}
