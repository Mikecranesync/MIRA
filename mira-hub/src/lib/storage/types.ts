export type StorageProviderKind = "google_drive" | "sharepoint" | "dropbox";

export interface StorageFile {
  id: string;
  name: string;
  mimeType: string;
  webUrl: string;
  modifiedAt: string; // ISO 8601
  sizeBytes: number;
}

export interface StorageProvider {
  listFiles(folderPath?: string): Promise<StorageFile[]>;
  /** Returns a fetch Response whose .body is the file content stream. */
  getFileContent(fileId: string): Promise<Response>;
}
