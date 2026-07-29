import { describe, expect, it } from "vitest";
import {
  uploadWorkOrderPhoto,
  workOrderPhotoUploadUrl,
  WORK_ORDER_PHOTO_UPLOAD_PATH,
} from "./wo-photo-upload";

// #1929: the WO detail "Add photo" button was a dead control (no handler). It now
// uploads through the existing local-upload endpoint. These prove the flow it
// triggers targets the right endpoint with the file attached.

function fakeFile(name = "evidence.jpg") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
}

describe("workOrderPhotoUploadUrl", () => {
  it("targets the canonical local-upload endpoint with a trailing slash", () => {
    expect(WORK_ORDER_PHOTO_UPLOAD_PATH).toBe("/api/uploads/local/");
    expect(workOrderPhotoUploadUrl("/hub")).toBe("/hub/api/uploads/local/");
    expect(workOrderPhotoUploadUrl("")).toBe("/api/uploads/local/");
  });
});

describe("uploadWorkOrderPhoto", () => {
  it("POSTs the file as multipart to the local-upload endpoint and returns the id", async () => {
    let captured: { url: string; method?: string; body: unknown } | null = null;
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), method: init?.method, body: init?.body };
      return new Response(JSON.stringify({ id: "upload-123" }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await uploadWorkOrderPhoto(fakeFile(), fakeFetch);

    expect(result).toEqual({ id: "upload-123" });
    expect(captured!.url).toMatch(/\/api\/uploads\/local\/$/);
    expect(captured!.method).toBe("POST");
    expect(captured!.body).toBeInstanceOf(FormData);
    expect((captured!.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("throws the server error message on a non-ok response", async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ error: "exceeds_size_limit" }), {
        status: 400,
      })) as unknown as typeof fetch;

    await expect(uploadWorkOrderPhoto(fakeFile(), fakeFetch)).rejects.toThrow("exceeds_size_limit");
  });

  it("throws a status-coded error when the body has no error field", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(uploadWorkOrderPhoto(fakeFile(), fakeFetch)).rejects.toThrow("upload_failed_500");
  });
});
