import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_ATTACHMENT_IMAGE_BYTES = 25 * 1024 * 1024;

const MIME_EXTENSIONS = new Map<string, string>([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
]);

export type SaveImageInput = {
  workspacePath: string;
  mimeType: string;
  fileName?: string;
  data: Buffer | Uint8Array;
};

export type SavedAttachment = {
  absolutePath: string;
  relativePath: string;
  terminalText: string;
  bytes: number;
  mimeType: string;
};

type AttachmentStoreOptions = {
  now?: () => Date;
};

export class AttachmentStore {
  private readonly now: () => Date;

  constructor(options: AttachmentStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async saveImage(input: SaveImageInput): Promise<SavedAttachment> {
    const mimeType = normalizeMimeType(input.mimeType);
    const extension = MIME_EXTENSIONS.get(mimeType);
    if (!extension) {
      throw new Error(`Unsupported image MIME type: ${input.mimeType}`);
    }

    const buffer = Buffer.from(input.data);
    if (buffer.byteLength === 0) {
      throw new Error("Clipboard image is empty");
    }
    if (buffer.byteLength > MAX_ATTACHMENT_IMAGE_BYTES) {
      throw new Error(`Clipboard image is too large: ${buffer.byteLength} bytes`);
    }

    const timestamp = formatTimestamp(this.now());
    const directory = path.join(input.workspacePath, ".agenthub", "attachments", timestamp.date);
    await mkdir(directory, { recursive: true });

    const baseName = sanitizeBaseName(input.fileName);
    for (let attempt = 1; attempt <= 1000; attempt += 1) {
      const suffix = attempt === 1 ? "" : `-${attempt}`;
      const fileName = `${timestamp.time}-${baseName}${suffix}.${extension}`;
      const absolutePath = path.resolve(directory, fileName);
      assertInsideDirectory(directory, absolutePath);

      try {
        await writeFile(absolutePath, buffer, { flag: "wx" });
        const relativePath = toPosixPath(path.relative(input.workspacePath, absolutePath));
        return {
          absolutePath,
          relativePath,
          terminalText: ` ${relativePath} `,
          bytes: buffer.byteLength,
          mimeType,
        };
      } catch (error) {
        if (isAlreadyExistsError(error)) {
          continue;
        }
        throw error;
      }
    }

    throw new Error("Unable to allocate attachment file name");
  }
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function sanitizeBaseName(fileName: string | undefined): string {
  const rawName = fileName?.trim() ? path.basename(fileName.replace(/\\/g, "/")) : "clipboard-image";
  const withoutExtension = rawName.replace(/\.[^.]*$/u, "");
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return sanitized || "clipboard-image";
}

function formatTimestamp(date: Date): { date: string; time: string } {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hour = pad2(date.getHours());
  const minute = pad2(date.getMinutes());
  const second = pad2(date.getSeconds());
  return {
    date: `${year}-${month}-${day}`,
    time: `${hour}${minute}${second}`,
  };
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function assertInsideDirectory(directory: string, absolutePath: string): void {
  const resolvedDirectory = path.resolve(directory);
  const relativePath = path.relative(resolvedDirectory, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Attachment path escaped the workspace");
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as NodeJS.ErrnoException).code === "EEXIST";
}
