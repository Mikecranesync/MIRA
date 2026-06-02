import type { StorageFile, StorageProvider } from "../types";

interface DropboxEntry {
  ".tag": "file" | "folder";
  id: string;
  name: string;
  client_modified: string;
  path_lower: string;
  size?: number;
}

export class DropboxProvider implements StorageProvider {
  constructor(private accessToken: string) {}

  async listFiles(folderPath?: string): Promise<StorageFile[]> {
    const res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: folderPath ?? "" }),
    });
    if (!res.ok) {
      throw new Error(`Dropbox list_folder ${res.status}: ${await res.text()}`);
    }
    const json: { entries: DropboxEntry[] } = await res.json();
    const files: StorageFile[] = [];

    for (const entry of json.entries ?? []) {
      if (entry[".tag"] !== "file") continue;
      files.push({
        id: entry.path_lower, // Dropbox uses path_lower as a stable identifier
        name: entry.name,
        mimeType: inferMimeFromFilename(entry.name),
        webUrl: `https://www.dropbox.com/home${entry.path_lower}`,
        modifiedAt: entry.client_modified,
        sizeBytes: entry.size ?? 0,
      });
    }
    return files;
  }

  getFileContent(pathLower: string): Promise<Response> {
    return fetch("https://content.dropboxapi.com/2/files/download", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Dropbox-API-Arg": JSON.stringify({ path: pathLower }),
        "Content-Type": "text/plain",
      },
    });
  }
}

function inferMimeFromFilename(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}
