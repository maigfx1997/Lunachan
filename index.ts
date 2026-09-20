import "server-only";
import type { Book, Chapter } from "@/db/schema";
import { loadBookImages } from "./assets";
import { buildDocx, buildEpub } from "./zip";
import { buildPdf } from "./pdf";
import { toFb2, toHtml, toJson, toMarkdown, toTxt } from "./text";
import {
  EXT_BY_FORMAT,
  MIME_BY_FORMAT,
  safeFileName,
  type BuiltFile,
  type ExportBook,
} from "./types";

export const EXPORT_FORMATS = ["epub", "pdf", "html", "txt", "md", "docx", "fb2", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: string): value is ExportFormat {
  return (EXPORT_FORMATS as readonly string[]).includes(value);
}

export function toExportBook(book: Book, chapterRows: Chapter[]): ExportBook {
  const usable = chapterRows.filter((chapter) => chapter.status === "done" && ((chapter.plainText ?? "").trim().length > 0 || (chapter.blocks ?? []).some((b) => b.type === "img")));
  const unavailable = chapterRows
    .filter((chapter) => chapter.status !== "done")
    .map((chapter) => ({ idx: chapter.idx, title: chapter.title }));

  return {
    id: book.id,
    title: book.title || "بدون عنوان",
    author: book.author,
    description: book.description,
    languageCode: book.languageCode,
    sourceUrl: book.sourceUrl,
    host: book.host,
    cover: book.coverData && book.coverMime ? { bytes: Buffer.from(book.coverData, "base64"), mime: book.coverMime } : null,
    chapters: usable.map((chapter) => ({
      idx: chapter.idx,
      title: chapter.title,
      status: chapter.status,
      blocks: chapter.blocks ?? [],
      plainText: chapter.plainText,
      sourceUrl: chapter.sourceUrl,
    })),
    unavailable,
  };
}

export async function buildExport(book: ExportBook, format: ExportFormat): Promise<BuiltFile> {
  const filename = safeFileName(book.title, book.id, EXT_BY_FORMAT[format]);
  const mime = MIME_BY_FORMAT[format];

  if (format === "txt") return { filename, mime, buffer: Buffer.from(toTxt(book), "utf8") };
  if (format === "md") return { filename, mime, buffer: Buffer.from(toMarkdown(book), "utf8") };
  if (format === "html") return { filename, mime, buffer: Buffer.from(toHtml(book), "utf8") };
  if (format === "json") return { filename, mime, buffer: Buffer.from(toJson(book), "utf8") };

  const needsImages = format === "epub" || format === "docx" || format === "pdf" || format === "fb2";
  const images = needsImages ? await loadBookImages(book) : new Map();

  if (format === "fb2") return { filename, mime, buffer: Buffer.from(toFb2(book, images), "utf8") };
  if (format === "epub") return { filename, mime, buffer: await buildEpub(book, images) };
  if (format === "docx") return { filename, mime, buffer: await buildDocx(book, images) };
  return { filename, mime, buffer: await buildPdf(book, images) };
}

export { MIME_BY_FORMAT, EXT_BY_FORMAT };
