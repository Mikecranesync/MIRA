import { WebPlugin } from "@capacitor/core";
import type { BuildConfigPlugin } from "./build-config";

export class BuildConfigWeb extends WebPlugin implements BuildConfigPlugin {
  async getApiBase(): Promise<{ apiBase: string }> {
    // For web/dev mode, use the default production URL (vite proxy handles routing)
    return { apiBase: "https://app.factorylm.com" };
  }
  
  async getDeepLinkConfig(): Promise<{ host: string; scheme: string }> {
    // For web/dev mode, use production values
    return { host: "app.factorylm.com", scheme: "factorylm" };
  }
}
