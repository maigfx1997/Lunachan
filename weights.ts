import type { Book, Chapter } from "@/db/schema";

export type FormatWeight = {
  format: string;
  bytes: number;
  estimated: boolean;
  images: number;
};

export type ChapterWeight = {
  idx: number;
  title: string;
  status: string;
  words: number;
  chars: number;
  images: number;
  bytes: number;
  share: number;
};

export type WeightsPanel = {
  totals: {
    chapters: number;
    fetched: number;
    failed: number;
    words: number;
    chars: number;
    images: number;
    readingMinutes: number;
    coverBytes: number;
    estimatedBytes: number;
  };
  formats: FormatWeight[];
  perChapter: ChapterWeight[];
};

const ARABIC_BYTE_FACTOR = 1.7; // Arabic codepoints take 2 bytes in UTF-8; average weighted.
const IMAGE_AVERAGE_BYTES = 140 * 1024;

export const FORMAT_LABELS: Record<string, string> = {
  epub: "EPUB (3.0)",
  pdf: "PDF (A5)",
  html: "HTML (صفحة واحدة)",
  txt: "TXT (نص خام)",
  md: "Markdown",
  docx: "Word (DOCX)",
  fb2: "FictionBook (FB2)",
  json: "JSON (بيانات كاملة)",
};

/** لوحة الأوزان: real text sizes + honest estimates for the binary formats. */
export function buildWeights(book: Book, chapterRows: Chapter[]): WeightsPanel {
  const rows = chapterRows.filter((chapter) => chapter.status === "done");
  const words = rows.reduce((sum, c) => sum + c.wordCount, 0);
  const chars = rows.reduce((sum, c) => sum + c.charCount, 0);
  const images = rows.reduce((sum, c) => sum + c.imageCount, 0);
  const coverBytes = book.coverData ? Math.floor((book.coverData.length * 3) / 4) : 0;

  const textBytes = Math.round(chars * ARABIC_BYTE_FACTOR);
  const imageBytes = images * IMAGE_AVERAGE_BYTES;
  const chapterTitlesBytes = rows.length * 90;

  const formats: FormatWeight[] = [
    { format: "txt", bytes: textBytes + chapterTitlesBytes, estimated: false, images: 0 },
    { format: "md", bytes: Math.round((textBytes + chapterTitlesBytes) * 1.08), estimated: false, images: 0 },
    { format: "html", bytes: Math.round((textBytes + chapterTitlesBytes) * 1.3) + 4096, estimated: false, images: 0 },
    { format: "json", bytes: Math.round((textBytes + chapterTitlesBytes) * 0.42), estimated: false, images: 0 },
    { format: "fb2", bytes: Math.round((textBytes + chapterTitlesBytes) * 1.35) + imageBytes, estimated: true, images },
    { format: "epub", bytes: Math.round((textBytes + chapterTitlesBytes) * 1.15) + imageBytes + coverBytes + 26 * 1024, estimated: true, images: images + (coverBytes ? 1 : 0) },
    { format: "docx", bytes: Math.round((textBytes + chapterTitlesBytes) * 0.55) + imageBytes + 22 * 1024, estimated: true, images },
    { format: "pdf", bytes: Math.round((textBytes + chapterTitlesBytes) * 0.5) + Math.round(imageBytes * 0.75) + 40 * 1024, estimated: true, images },
  ];

  const totalBytes = Math.max(1, rows.reduce((sum, c) => sum + c.charCount, 0));
  const perChapter: ChapterWeight[] = chapterRows.map((chapter) => ({
    idx: chapter.idx,
    title: chapter.title,
    status: chapter.status,
    words: chapter.wordCount,
    chars: chapter.charCount,
    images: chapter.imageCount,
    bytes: Math.round(chapter.charCount * ARABIC_BYTE_FACTOR),
    share: Math.round((chapter.charCount / totalBytes) * 100),
  }));

  return {
    totals: {
      chapters: chapterRows.length,
      fetched: chapterRows.filter((c) => c.status === "done").length,
      failed: chapterRows.filter((c) => c.status === "failed" || c.status === "empty").length,
      words,
      chars,
      images,
      readingMinutes: Math.max(1, Math.round(words / 180)),
      coverBytes,
      estimatedBytes: formats.reduce((max, format) => Math.max(max, format.bytes), 0),
    },
    formats,
    perChapter,
  };
}

export { formatBytes } from "./weights-format";
