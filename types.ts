import type { ChapterBlock } from "@/db/schema";

export type ExportChapter = {
  idx: number;
  title: string;
  status: string;
  blocks: ChapterBlock[];
  plainText: string;
  sourceUrl: string;
};

export type ExportCover = { bytes: Buffer; mime: string } | null;

export type ExportBook = {
  id: number;
  title: string;
  author: string;
  description: string;
  languageCode: string;
  sourceUrl: string;
  host: string;
  cover: ExportCover;
  chapters: ExportChapter[];
  /** chapters the site refused to serve — reported, never invented. */
  unavailable: { idx: number; title: string }[];
};

export type BuiltFile = {
  filename: string;
  mime: string;
  buffer: Buffer;
};

export const MIME_BY_FORMAT: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  fb2: "application/xml; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export const EXT_BY_FORMAT: Record<string, string> = {
  epub: "epub",
  pdf: "pdf",
  html: "html",
  txt: "txt",
  md: "md",
  docx: "docx",
  fb2: "fb2",
  json: "json",
};

export function safeFileName(title: string, id: number, extension: string): string {
  const base = title
    .replace(/[\\/:*?"<>|\n\r\t]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  return `${base || `book-${id}`} - ${id}.${extension}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeXml(value: string): string {
  return escapeHtml(value).replace(/'/g, "&apos;");
}
