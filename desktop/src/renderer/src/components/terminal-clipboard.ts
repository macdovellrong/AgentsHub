type ClipboardImageCandidate = {
  kind?: string;
  type?: string;
};

type ClipboardImageData = {
  items?: ArrayLike<ClipboardImageCandidate> | null;
  files?: ArrayLike<ClipboardImageCandidate> | null;
};

export function hasClipboardImage(data: ClipboardImageData | null | undefined): boolean {
  if (!data) {
    return false;
  }

  const items = Array.from(data.items ?? []);
  if (items.some((item) => item.kind === "file" && isImageMimeType(item.type))) {
    return true;
  }

  return Array.from(data.files ?? []).some((file) => isImageMimeType(file.type));
}

function isImageMimeType(value: string | undefined): boolean {
  return typeof value === "string" && value.toLowerCase().startsWith("image/");
}
