import type { StorageFile, StorageProvider } from "../types";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const PAGE_SIZE = 200;

export class GoogleDriveProvider implements StorageProvider {
  constructor(private accessToken: string) {}

  async listFiles(folderId?: string): Promise<StorageFile[]> {
    const files: StorageFile[] = [];
    let pageToken: string | undefined;

    const parentQ = folderId ? `'${folderId}' in parents and ` : "";
    const q = encodeURIComponent(`${parentQ}trashed=false`);
    const fields =
      "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)";

    do {
      const url =
        `${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=${PAGE_SIZE}` +
        (pageToken ? `&pageToken=${pageToken}` : "");

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`Drive files.list ${res.status}: ${await res.text()}`);
      }
      const json: {
        nextPageToken?: string;
        files: Array<{
          id: string;
          name: string;
          mimeType: string;
          webViewLink: string;
          modifiedTime: string;
          size?: string;
        }>;
      } = await res.json();

      for (const f of json.files ?? []) {
        if (f.mimeType === "application/vnd.google-apps.folder") continue;
        files.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          webUrl: f.webViewLink,
          modifiedAt: f.modifiedTime,
          sizeBytes: f.size ? Number(f.size) : 0,
        });
      }
      pageToken = json.nextPageToken;
    } while (pageToken);

    return files;
  }

  getFileContent(fileId: string): Promise<Response> {
    return fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }
}
