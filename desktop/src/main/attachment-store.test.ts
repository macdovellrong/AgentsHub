import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AttachmentStore, MAX_ATTACHMENT_IMAGE_BYTES } from "./attachment-store";

async function createWorkspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "agenthub-attachments-"));
}

describe("AttachmentStore", () => {
  it("saves clipboard images under the workspace attachments directory", async () => {
    const workspacePath = await createWorkspace();
    const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const store = new AttachmentStore({
      now: () => new Date(2026, 4, 16, 8, 9, 10),
    });

    const saved = await store.saveImage({
      workspacePath,
      mimeType: "image/png",
      fileName: "screen shot.png",
      data: imageData,
    });

    expect(saved.relativePath).toBe(".agenthub/attachments/2026-05-16/080910-screen-shot.png");
    expect(saved.terminalText).toBe(" .agenthub/attachments/2026-05-16/080910-screen-shot.png ");
    expect(saved.bytes).toBe(imageData.byteLength);
    expect(saved.mimeType).toBe("image/png");
    expect(await readFile(saved.absolutePath)).toEqual(imageData);
    expect(path.relative(workspacePath, saved.absolutePath).startsWith(".agenthub")).toBe(true);
  });

  it("does not overwrite an existing image with the same timestamp and name", async () => {
    const workspacePath = await createWorkspace();
    const store = new AttachmentStore({
      now: () => new Date(2026, 4, 16, 8, 9, 10),
    });

    const first = await store.saveImage({
      workspacePath,
      mimeType: "image/png",
      fileName: "image.png",
      data: Buffer.from("first"),
    });
    const second = await store.saveImage({
      workspacePath,
      mimeType: "image/png",
      fileName: "image.png",
      data: Buffer.from("second"),
    });

    expect(first.relativePath).toBe(".agenthub/attachments/2026-05-16/080910-image.png");
    expect(second.relativePath).toBe(".agenthub/attachments/2026-05-16/080910-image-2.png");
    expect(await readFile(first.absolutePath, "utf8")).toBe("first");
    expect(await readFile(second.absolutePath, "utf8")).toBe("second");
  });

  it("rejects unsupported, empty, and oversized images", async () => {
    const workspacePath = await createWorkspace();
    const store = new AttachmentStore();

    await expect(
      store.saveImage({
        workspacePath,
        mimeType: "text/plain",
        fileName: "notes.txt",
        data: Buffer.from("not an image"),
      }),
    ).rejects.toThrow("Unsupported image MIME type");

    await expect(
      store.saveImage({
        workspacePath,
        mimeType: "image/png",
        fileName: "empty.png",
        data: Buffer.alloc(0),
      }),
    ).rejects.toThrow("Clipboard image is empty");

    await expect(
      store.saveImage({
        workspacePath,
        mimeType: "image/png",
        fileName: "large.png",
        data: Buffer.alloc(MAX_ATTACHMENT_IMAGE_BYTES + 1),
      }),
    ).rejects.toThrow("Clipboard image is too large");
  });
});
