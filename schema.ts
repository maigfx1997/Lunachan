import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * A scraped novel/book. Content is stored exactly as it was published —
 * nothing is generated or re-written by the app.
 */
export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    sourceUrl: text("source_url").notNull(),
    host: text("host").notNull().default(""),
    adapter: text("adapter").notNull().default("generic"),
    title: text("title").notNull().default(""),
    author: text("author").notNull().default(""),
    description: text("description").notNull().default(""),
    languageCode: text("language_code").notNull().default("ar"),
    coverUrl: text("cover_url").notNull().default(""),
    coverMime: text("cover_mime").notNull().default(""),
    /** base64 of the ORIGINAL cover bytes — the cover is never re-encoded. */
    coverData: text("cover_data").notNull().default(""),
    totalChapters: integer("total_chapters").notNull().default(0),
    status: text("status").notNull().default("importing"),
    fetchedChapters: integer("fetched_chapters").notNull().default(0),
    failedChapters: integer("failed_chapters").notNull().default(0),
    error: text("error").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("books_source_url_key").on(table.sourceUrl)],
);

export const chapters = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    title: text("title").notNull().default(""),
    sourceUrl: text("source_url").notNull().default(""),
    /** pending | fetching | done | failed | empty */
    status: text("status").notNull().default("pending"),
    /** [{ type: "p", text } | { type: "img", src, alt }] in original order */
    blocks: jsonb("blocks").$type<ChapterBlock[]>().default([]).notNull(),
    plainText: text("plain_text").notNull().default(""),
    wordCount: integer("word_count").notNull().default(0),
    charCount: integer("char_count").notNull().default(0),
    imageCount: integer("image_count").notNull().default(0),
    error: text("error").notNull().default(""),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("chapters_book_idx_key").on(table.bookId, table.idx),
    index("chapters_book_id_idx").on(table.bookId),
  ],
);

export type ChapterBlock =
  | { type: "p"; text: string }
  | { type: "img"; src: string; alt?: string }
  | { type: "h"; text: string };

export type Book = typeof books.$inferSelect;
export type NewBook = typeof books.$inferInsert;
export type Chapter = typeof chapters.$inferSelect;
export type NewChapter = typeof chapters.$inferInsert;
