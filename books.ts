import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { books, chapters, type Book, type Chapter, type ChapterBlock } from "@/db/schema";
import { fetchBinary } from "./scrape/http";
import { countWords } from "./scrape/dom";
import { getAdapter, normalizeInputUrl, scrapeBookMeta, scrapeChapter } from "./scrape";
import type { BookMeta, ChapterRef } from "./scrape/types";

export type BookWithChapters = {
  book: Book;
  chapters: Chapter[];
};

function metaFromBook(book: Book): BookMeta {
  return {
    adapter: book.adapter,
    sourceUrl: book.sourceUrl,
    host: book.host,
    title: book.title,
    author: book.author,
    description: book.description,
    languageCode: book.languageCode,
    coverUrl: book.coverUrl,
    chapters: [],
  };
}

/** Creates (or refreshes) a book record plus one stub row per real chapter. */
export async function importBook(rawUrl: string): Promise<BookWithChapters> {
  const normalized = normalizeInputUrl(rawUrl);
  if ("error" in normalized) throw new Error(normalized.error);

  const { meta, adapter } = await scrapeBookMeta(normalized.url);

  // The original cover file is downloaded once and served untouched afterwards.
  let coverMime = "";
  let coverData = "";
  if (meta.coverUrl) {
    const bin = await fetchBinary(meta.coverUrl, meta.sourceUrl);
    if (bin.ok && bin.mime.startsWith("image/")) {
      coverMime = bin.mime;
      coverData = bin.data.toString("base64");
    }
  }

  const existing = await db.select().from(books).where(eq(books.sourceUrl, meta.sourceUrl)).limit(1);
  const payload = {
    sourceUrl: meta.sourceUrl,
    host: meta.host,
    adapter: meta.adapter || adapter.name,
    title: meta.title || "بدون عنوان",
    author: meta.author,
    description: meta.description,
    languageCode: meta.languageCode,
    coverUrl: meta.coverUrl,
    coverMime,
    coverData,
    totalChapters: meta.chapters.length,
    status: "importing",
    error: "",
    updatedAt: new Date(),
  };

  let bookId: number;
  if (existing.length > 0) {
    bookId = existing[0].id;
    await db
      .update(books)
      .set({
        ...payload,
        ...(coverData ? {} : { coverData: existing[0].coverData, coverMime: existing[0].coverMime }),
      })
      .where(eq(books.id, bookId));
  } else {
    const inserted = await db.insert(books).values(payload).returning({ id: books.id });
    bookId = inserted[0].id;
  }

  const rows = meta.chapters.map((chapter) => ({
    bookId,
    idx: chapter.idx,
    title: chapter.title,
    sourceUrl: chapter.url,
    status: "pending",
  }));

  if (rows.length > 0) {
    await db
      .insert(chapters)
      .values(rows)
      .onConflictDoNothing({ target: [chapters.bookId, chapters.idx] });

    // Refresh only the rows whose title/url actually changed (a 500-chapter
    // novel would otherwise cost 500 extra round-trips on every import).
    const current = await db
      .select({ idx: chapters.idx, title: chapters.title, sourceUrl: chapters.sourceUrl })
      .from(chapters)
      .where(eq(chapters.bookId, bookId));
    const byIdx = new Map(current.map((row) => [row.idx, row]));
    const changed = rows.filter((row) => {
      const existingRow = byIdx.get(row.idx);
      return !existingRow || existingRow.title !== row.title || existingRow.sourceUrl !== row.sourceUrl;
    });

    if (changed.length > 0) {
      const values = sql.join(
        changed.map((row) => sql`(${bookId}::int, ${row.idx}::int, ${row.title}::text, ${row.sourceUrl}::text)`),
        sql`, `,
      );
      await db.execute(sql`
        update ${chapters} as c
        set title = v.title, source_url = v.source_url
        from (values ${values}) as v(book_id, idx, title, source_url)
        where c.book_id = v.book_id and c.idx = v.idx
      `);
    }
  }

  return getBookWithChapters(bookId);
}

export async function getBookWithChapters(bookId: number): Promise<BookWithChapters> {
  const found = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (found.length === 0) throw new Error("not-found");
  const rows = await db
    .select()
    .from(chapters)
    .where(eq(chapters.bookId, bookId))
    .orderBy(asc(chapters.idx));
  return { book: found[0], chapters: rows };
}

export async function listBooks(): Promise<Array<Book & { doneChapters: number; failedChapters: number }>> {
  const rows = await db.select().from(books).orderBy(desc(books.createdAt)).limit(60);
  const counts = await db
    .select({
      bookId: chapters.bookId,
      done: sql<number>`count(*) filter (where ${chapters.status} = 'done')`.mapWith(Number),
      failed: sql<number>`count(*) filter (where ${chapters.status} = 'failed')`.mapWith(Number),
    })
    .from(chapters)
    .groupBy(chapters.bookId);
  const map = new Map(counts.map((row) => [row.bookId, row]));
  return rows.map((book) => ({
    ...book,
    doneChapters: map.get(book.id)?.done ?? 0,
    failedChapters: map.get(book.id)?.failed ?? 0,
  }));
}

export async function deleteBook(bookId: number): Promise<void> {
  await db.delete(books).where(eq(books.id, bookId));
}

function refreshBookProgress(bookId: number) {
  return db
    .update(books)
    .set({
      fetchedChapters: sql`(select count(*) from ${chapters} where ${chapters.bookId} = ${bookId} and ${chapters.status} = 'done')`,
      failedChapters: sql`(select count(*) from ${chapters} where ${chapters.bookId} = ${bookId} and ${chapters.status} = 'failed')`,
      status: sql`case
          when (select count(*) from ${chapters} where ${chapters.bookId} = ${bookId} and ${chapters.status} in ('pending','fetching')) > 0 then 'importing'
          when (select count(*) from ${chapters} where ${chapters.bookId} = ${bookId} and ${chapters.status} = 'done') > 0 then 'ready'
          else 'failed'
        end`,
      updatedAt: new Date(),
    })
    .where(eq(books.id, bookId));
}

/** Fetches exactly one chapter — driven by the client so progress stays alive. */
export async function fetchChapterContent(
  bookId: number,
  idx: number,
): Promise<{ chapter: Chapter; book: Book }> {
  const bookRows = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  if (bookRows.length === 0) throw new Error("not-found");
  const book = bookRows[0];

  const chapterRows = await db
    .select()
    .from(chapters)
    .where(and(eq(chapters.bookId, bookId), eq(chapters.idx, idx)))
    .limit(1);
  if (chapterRows.length === 0) throw new Error("chapter-not-found");
  const chapter = chapterRows[0];

  await db.update(chapters).set({ status: "fetching" }).where(eq(chapters.id, chapter.id));

  const adapter = getAdapter(book.sourceUrl);
  const meta = metaFromBook(book);
  const ref: ChapterRef = { idx: chapter.idx, title: chapter.title, url: chapter.sourceUrl || book.sourceUrl };

  let updated: Chapter;
  try {
    const content = await scrapeChapter(adapter, ref, meta);
    const blocks: ChapterBlock[] = content.blocks.filter((block) => block.type !== "p" || block.text.trim().length > 0);
    const text = content.text || blocks.filter((b) => b.type !== "p").map(() => "").join("");
    const hasBody = text.replace(/\s+/g, "").length > 0 || blocks.some((b) => b.type === "img");
    const wordCount = countWords(text);

    const rows = await db
      .update(chapters)
      .set({
        title: content.title || chapter.title,
        blocks,
        plainText: text,
        wordCount,
        charCount: text.length,
        imageCount: content.imageCount,
        status: hasBody ? "done" : "empty",
        error: hasBody ? "" : "empty-content",
        fetchedAt: new Date(),
      })
      .where(eq(chapters.id, chapter.id))
      .returning();
    updated = rows[0];
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown-error";
    const rows = await db
      .update(chapters)
      .set({ status: "failed", error: message, fetchedAt: new Date() })
      .where(eq(chapters.id, chapter.id))
      .returning();
    updated = rows[0];
  }

  await refreshBookProgress(bookId);
  const fresh = await db.select().from(books).where(eq(books.id, bookId)).limit(1);
  return { chapter: updated, book: fresh[0] };
}

export async function resetFailedChapters(bookId: number): Promise<number> {
  const rows = await db
    .update(chapters)
    .set({ status: "pending", error: "" })
    .where(and(eq(chapters.bookId, bookId), eq(chapters.status, "failed")))
    .returning({ id: chapters.id });
  await refreshBookProgress(bookId);
  return rows.length;
}
