import type { Attachment } from "./types";

/**
 * Platform capabilities are injected by each surface. The shared reducer stays
 * pure and never invokes this boundary.
 */
export interface PlatformAdapter {
  attachPhoto(): Promise<Attachment | null>;
  attachFile(): Promise<Attachment | null>;
  attachCamera(): Promise<Attachment | null>;
  scanMachine(): Promise<string | null>;
  shareArtifact(artifactId: string): Promise<"shared" | "cancelled">;
  onBack(): "handled" | "pass";
  /**
   * Optional: take files the user pasted or dropped onto the composer, through
   * the same intake as the picker. Returns what was accepted (possibly fewer
   * than given). A host without it gets no paste/drop intake.
   */
  adoptFiles?(files: readonly File[]): Attachment[];
  /** Optional: the user removed a picked attachment before sending; drop its bytes. */
  release?(id: string): void;
}
