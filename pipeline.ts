"use client";

import type { ApiBook, ApiChapter } from "./types";

export type ImportResult = { book: ApiBook; chapters: ApiChapter[] };

export type PipelineProgress = {
  total: number;
  done: number;
  failed: number;
  currentIndex: number;
};

export async function requestImport(url: string): Promise<ImportResult> {
  const res = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as ImportResult & { error?: string; message?: string };
  if (!res.ok) {
    const error = new Error(data.message ?? data.error ?? "generic") as Error & { code?: string };
    error.code = data.error;
    throw error;
  }
  return { book: data.book, chapters: data.chapters };
}

export async function fetchChapter(bookId: number, idx: number): Promise<{ chapter: ApiChapter; book: ApiBook }> {
  const res = await fetch(`/api/books/${bookId}/chapters/${idx}/fetch`, { method: "POST" });
  const data = (await res.json()) as { chapter: ApiChapter; book: ApiBook; error?: string };
  if (!res.ok || !data.chapter) throw new Error(data.error ?? "fetch-failed");
  return { chapter: data.chapter, book: data.book };
}

export async function loadChapter(bookId: number, idx: number): Promise<ApiChapter> {
  const res = await fetch(`/api/books/${bookId}/chapters/${idx}`, { cache: "no-store" });
  const data = (await res.json()) as { chapter: ApiChapter; error?: string };
  if (!res.ok || !data.chapter) throw new Error(data.error ?? "not-found");
  return data.chapter;
}

export async function retryFailed(bookId: number): Promise<{ book: ApiBook; chapters: ApiChapter[] }> {
  const res = await fetch(`/api/books/${bookId}/retry`, { method: "POST" });
  const data = (await res.json()) as { book: ApiBook; chapters: ApiChapter[] };
  return { book: data.book, chapters: data.chapters ?? [] };
}

/**
 * Fetches chapters with a small concurrency window. Driven from the browser so
 * the cute progress bar always reflects real work done on the server.
 */
export async function runFetchLoop(
  bookId: number,
  indexes: number[],
  options: {
    concurrency?: number;
    onTick: (chapter: ApiChapter, progress: PipelineProgress) => void;
    onBook?: (book: ApiBook) => void;
    shouldStop?: () => boolean;
  },
): Promise<PipelineProgress> {
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 4));
  const queue = [...indexes];
  let done = 0;
  let failed = 0;
  let currentIndex = queue[0] ?? 0;

  const worker = async () => {
    for (;;) {
      if (options.shouldStop?.()) return;
      const idx = queue.shift();
      if (idx === undefined) return;
      currentIndex = idx;
      try {
        const { chapter, book } = await fetchChapter(bookId, idx);
        if (chapter.status === "done") done += 1;
        else failed += 1;
        options.onBook?.(book);
        options.onTick(chapter, { total: indexes.length, done, failed, currentIndex: idx });
      } catch {
        failed += 1;
        options.onTick(
          {
            id: -1,
            idx,
            title: "",
            sourceUrl: "",
            status: "failed",
            wordCount: 0,
            charCount: 0,
            imageCount: 0,
            error: "fetch-failed",
            blocks: [],
            plainText: "",
            preview: "",
          },
          { total: indexes.length, done, failed, currentIndex: idx },
        );
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return { total: indexes.length, done, failed, currentIndex };
}

export function coverSrc(bookId: number): string {
  return `/api/books/${bookId}/cover`;
}

export function proxiedImage(src: string, referer?: string): string {
  return `/api/image?u=${encodeURIComponent(src)}${referer ? `&r=${encodeURIComponent(referer)}` : ""}`;
}
