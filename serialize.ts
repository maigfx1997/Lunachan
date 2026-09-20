import type { Book, Chapter } from "@/db/schema";

export type PublicBook = Omit<Book, "coverData"> & { hasCover: boolean };

export function serializeBook(book: Book): PublicBook {
  const { coverData, ...rest } = book;
  return { ...rest, hasCover: coverData.length > 0 };
}

export type PublicChapter = {
  id: number;
  idx: number;
  title: string;
  sourceUrl: string;
  status: string;
  wordCount: number;
  charCount: number;
  imageCount: number;
  error: string;
  blocks: Chapter["blocks"];
  plainText: string;
  preview: string;
};

export function serializeChapter(chapter: Chapter, withContent = false): PublicChapter {
  return {
    id: chapter.id,
    idx: chapter.idx,
    title: chapter.title,
    sourceUrl: chapter.sourceUrl,
    status: chapter.status,
    wordCount: chapter.wordCount,
    charCount: chapter.charCount,
    imageCount: chapter.imageCount,
    error: chapter.error,
    blocks: withContent ? chapter.blocks : [],
    plainText: withContent ? chapter.plainText : "",
    preview: withContent ? chapter.plainText.slice(0, 400) : chapter.plainText.slice(0, 220),
  };
}
