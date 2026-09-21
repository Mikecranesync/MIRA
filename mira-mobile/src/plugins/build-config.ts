import { registerPlugin } from "@capacitor/core";

export interface BuildConfigPlugin {
  getApiBase(): Promise<{ apiBase: string }>;
  getDeepLinkConfig(): Promise<{ host: string; scheme: string }>;
}

const BuildConfig = registerPlugin<BuildConfigPlugin>("BuildConfig", {
  web: () =>
    import("./build-config-web").then((m) => new m.BuildConfigWeb()),
});

export default BuildConfig;
