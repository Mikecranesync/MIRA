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
}
