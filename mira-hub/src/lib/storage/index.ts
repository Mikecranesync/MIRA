export type { StorageFile, StorageProvider, StorageProviderKind } from "./types";
export { GoogleDriveProvider } from "./providers/google-drive";
export { SharePointProvider } from "./providers/sharepoint";
export { DropboxProvider } from "./providers/dropbox";

import type { StorageProvider, StorageProviderKind } from "./types";
import { GoogleDriveProvider } from "./providers/google-drive";
import { SharePointProvider } from "./providers/sharepoint";
import { DropboxProvider } from "./providers/dropbox";

export function getProviderClient(
  kind: StorageProviderKind,
  accessToken: string,
): StorageProvider {
  switch (kind) {
    case "google_drive":
      return new GoogleDriveProvider(accessToken);
    case "sharepoint":
      return new SharePointProvider(accessToken);
    case "dropbox":
      return new DropboxProvider(accessToken);
    default:
      throw new Error(`unknown storage provider: ${kind}`);
  }
}
