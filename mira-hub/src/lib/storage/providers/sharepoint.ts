import type { StorageFile, StorageProvider } from "../types";

const GRAPH = "https://graph.microsoft.com/v1.0";

interface GraphDriveItem {
  id: string;
  name: string;
  file?: { mimeType: string };
  folder?: object;
  webUrl: string;
  lastModifiedDateTime: string;
  size: number;
}

export class SharePointProvider implements StorageProvider {
  constructor(private accessToken: string) {}

  async listFiles(itemId?: string): Promise<StorageFile[]> {
    const endpoint = itemId
      ? `${GRAPH}/me/drive/items/${itemId}/children`
      : `${GRAPH}/me/drive/root/children`;

    const url = `${endpoint}?$select=id,name,file,folder,webUrl,lastModifiedDateTime,size&$top=200`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Graph drive.children ${res.status}: ${await res.text()}`);
    }
    const json: { value: GraphDriveItem[] } = await res.json();
    const files: StorageFile[] = [];

    for (const item of json.value ?? []) {
      if (item.folder) continue; // skip folders for now
      if (!item.file) continue;
      files.push({
        id: item.id,
        name: item.name,
        mimeType: item.file.mimeType,
        webUrl: item.webUrl,
        modifiedAt: item.lastModifiedDateTime,
        sizeBytes: item.size ?? 0,
      });
    }
    return files;
  }

  getFileContent(itemId: string): Promise<Response> {
    return fetch(`${GRAPH}/me/drive/items/${itemId}/content`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }
}
