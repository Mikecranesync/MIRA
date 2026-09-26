/**
 * Web `PlatformAdapter` for the shared FactoryLM shell (#3806 step 1).
 *
 * The shell is platform-agnostic; everything device-shaped goes through this
 * six-method seam. Capacitor implements it natively on Android; this is the
 * browser side for `app.factorylm.com`.
 *
 * The rule here is **honesty over pretence**: where the web genuinely cannot do
 * something, the adapter returns the contract's "didn't happen" value rather
 * than faking a result. A shell that believes a scan succeeded when no scan is
 * possible produces a machine context nobody confirmed — exactly the class of
 * failure the UNS gate exists to prevent.
 *
 * `deps` is injected so every branch is unit-testable without a browser.
 */
// Relative, not an alias. The alias would live in tsconfig.json, which the UI
// lifecycle guard (#3626) holds frozen -- and a path alias is not worth an
// audited legacy-ui exception for a single type-only import. Step 2 mounts the
// shell for real and can carry the alias under a reviewed exception then.
import type { Attachment, PlatformAdapter } from "../../../packages/factorylm-interaction/src";

export interface WebAdapterDeps {
  /** Opens a file chooser and resolves with the chosen file, or null if dismissed. */
  pickFile(accept: string, capture?: "environment" | "user"): Promise<File | null>;
  /** `navigator.share` when present. Undefined on browsers without Web Share. */
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  /** History length + back, injected so onBack is testable. */
  history: { length: number; back(): void };
  /** Absolute base for artifact URLs handed to Web Share. */
  origin: string;
  /** Monotonic id source; injected to keep tests deterministic. */
  newId(): string;
}

const IMAGE_ACCEPT = "image/*";
const FILE_ACCEPT = "application/pdf,image/*,.csv,.txt,.md";

function kindOf(file: File): Attachment["kind"] {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
  if (file.type.startsWith("image/")) return "photo";
  return "file";
}

function toAttachment(file: File, id: string): Attachment {
  return {
    id,
    name: file.name,
    // A browser can hand back an empty `type` for an unrecognised extension.
    // Guessing a media type here would put a wrong Content-Type on the upload,
    // so record the honest unknown and let the server sniff it.
    mediaType: file.type || "application/octet-stream",
    kind: kindOf(file),
    // "ready" means *selected*, not *uploaded*. The host owns the upload and
    // moves this to queued/failed; the adapter must not claim more than it did.
    status: "ready",
  };
}

/**
 * The shell only carries the small `Attachment` descriptor; the bytes stay with
 * the adapter, keyed by the id the chip shows, until the host uploads them
 * (#4019 — before this they were dropped and the host had nothing to send).
 */
export interface HubWebAdapter extends PlatformAdapter {
  heldFile(id: string): File | undefined;
  forget(id: string): void;
}

const MAX_HELD = 8;

export function createWebAdapter(deps: WebAdapterDeps): HubWebAdapter {
  const held = new Map<string, File>();
  const pick = async (accept: string, capture?: "environment" | "user"): Promise<Attachment | null> => {
    const file = await deps.pickFile(accept, capture);
    if (!file) return null;
    const attachment = toAttachment(file, deps.newId());
    held.set(attachment.id, file);
    // A removed chip sends the adapter no event, so bound what is held: the
    // oldest file is released past MAX_HELD (Map keeps insertion order). A
    // chip whose bytes were released fails closed at send ("attach it again").
    while (held.size > MAX_HELD) held.delete(held.keys().next().value as string);
    return attachment;
  };

  return {
    heldFile: (id: string) => held.get(id),
    forget: (id: string) => { held.delete(id); },

    attachPhoto: () => pick(IMAGE_ACCEPT),

    attachFile: () => pick(FILE_ACCEPT),

    /**
     * `capture="environment"` is a *hint*. Mobile browsers open the camera;
     * desktop browsers ignore it and show a normal file chooser. That degrade is
     * acceptable — the user still ends up attaching the image they meant — and
     * it is why this is not reported as unsupported.
     */
    attachCamera: () => pick(IMAGE_ACCEPT, "environment"),

    /**
     * Not supported on web, and deliberately not faked.
     *
     * A real scan needs camera access plus a decoder. Returning a plausible
     * machine id here would hand the shell an asset context that no human
     * confirmed, which is precisely what `.claude/rules/uns-confirmation-gate.md`
     * forbids. `null` means "no scan happened", and the shell already handles it.
     */
    scanMachine: async () => null,

    /**
     * Web Share where the browser has it; "cancelled" otherwise.
     *
     * A rejected share promise is indistinguishable from a user dismissing the
     * sheet, so both map to "cancelled" — the honest answer is "not shared",
     * never "shared".
     */
    shareArtifact: async (artifactId: string) => {
      if (!deps.share) return "cancelled";
      try {
        await deps.share({
          title: "FactoryLM artifact",
          url: `${deps.origin}/artifacts/${encodeURIComponent(artifactId)}`,
        });
        return "shared";
      } catch {
        return "cancelled";
      }
    },

    /**
     * "handled" only when there is somewhere to go. On a freshly-opened tab
     * `history.length` is 1 and `back()` does nothing — claiming "handled" there
     * would swallow the gesture and strand the user on the current layer.
     */
    onBack: () => {
      if (deps.history.length > 1) {
        deps.history.back();
        return "handled";
      }
      return "pass";
    },
  };
}

/** Browser wiring for {@link createWebAdapter}. Call only where `document` exists. */
export function browserAdapterDeps(): WebAdapterDeps {
  return {
    pickFile: (accept, capture) =>
      new Promise<File | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        if (capture) input.setAttribute("capture", capture);
        input.style.display = "none";
        // A dismissed chooser fires no event in most browsers, so the element
        // would leak and the promise would never settle. `cancel` is supported
        // broadly enough to rely on, and the focus fallback covers the rest.
        const done = (file: File | null) => {
          input.remove();
          resolve(file);
        };
        input.addEventListener("change", () => done(input.files?.[0] ?? null), { once: true });
        input.addEventListener("cancel", () => done(null), { once: true });
        window.addEventListener(
          "focus",
          () => setTimeout(() => { if (document.body.contains(input)) done(input.files?.[0] ?? null); }, 500),
          { once: true },
        );
        document.body.appendChild(input);
        input.click();
      }),
    share: typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? (data) => navigator.share(data)
      : undefined,
    history: { get length() { return window.history.length; }, back: () => window.history.back() },
    origin: typeof window !== "undefined" ? window.location.origin : "",
    newId: () => `att_${crypto.randomUUID()}`,
  };
}
