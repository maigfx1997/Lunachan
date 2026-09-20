import "server-only";
import { fetchBinary } from "@/lib/scrape/http";
import type { ExportBook } from "./types";

export const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
};

export type LoadedImage = { bytes: Buffer; mime: string; width: number; height: number };

export function imageDimensions(bytes: Buffer, mime: string): { width: number; height: number } {
  try {
    if (mime === "image/png" && bytes.length > 24) {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    if (mime === "image/gif" && bytes.length > 10) {
      return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
    }
    if (mime === "image/jpeg") {
      let offset = 2;
      while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1;
          continue;
        }
        const marker = bytes[offset + 1];
        const length = bytes.readUInt16BE(offset + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
        }
        offset += 2 + length;
      }
    }
    if (mime === "image/webp" && bytes.length > 30) {
      const chunk = bytes.subarray(12, 16).toString("ascii");
      if (chunk === "VP8X") {
        const width = 1 + ((bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) & 0xffffff);
        const height = 1 + ((bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) & 0xffffff);
        return { width, height };
      }
      if (chunk === "VP8 ") {
        return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === "VP8L") {
        const bits = bytes.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    }
  } catch {
    /* unknown dimensions: callers fall back to defaults */
  }
  return { width: 0, height: 0 };
}

async function loadOne(url: string, referer: string): Promise<LoadedImage | null> {
  const bin = await fetchBinary(url, referer);
  if (!bin.ok || bin.data.length === 0) return null;
  if (!/^image\//.test(bin.mime)) return null;
  if (bin.mime === "image/svg+xml") return null; // keep exports portable
  const dims = imageDimensions(bin.data, bin.mime);
  return { bytes: bin.data, mime: bin.mime, width: dims.width, height: dims.height };
}

/** Downloads every in-chapter image exactly once, untouched. */
export async function loadBookImages(
  book: ExportBook,
  limits = { maxImages: 400, maxTotalBytes: 60 * 1024 * 1024, concurrency: 4 },
): Promise<Map<string, LoadedImage>> {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const chapter of book.chapters) {
    for (const block of chapter.blocks) {
      if (block.type === "img" && !seen.has(block.src)) {
        seen.add(block.src);
        urls.push(block.src);
      }
    }
  }
  const limited = urls.slice(0, limits.maxImages);
  const result = new Map<string, LoadedImage>();
  let totalBytes = 0;

  for (let i = 0; i < limited.length; i += limits.concurrency) {
    const batch = limited.slice(i, i + limits.concurrency);
    const loaded = await Promise.all(batch.map((url) => loadOne(url, book.sourceUrl)));
    loaded.forEach((image, index) => {
      if (!image) return;
      totalBytes += image.bytes.length;
      if (totalBytes > limits.maxTotalBytes) return;
      result.set(batch[index], image);
    });
    if (totalBytes > limits.maxTotalBytes) break;
  }
  return result;
}

export function exportableChapters(book: ExportBook): ExportChapterList {
  return book.chapters.filter((chapter) => chapter.status === "done");
}

type ExportChapterList = ExportBook["chapters"];
