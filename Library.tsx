"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "./Providers";
import type { ApiBook } from "@/lib/client/types";

function statusLabel(book: ApiBook, t: ReturnType<typeof useApp>["t"]): { text: string; tone: string } {
  const done = book.doneChapters ?? 0;
  if (book.totalChapters > 0 && done >= book.totalChapters) return { text: `✅ ${t.statusReady}`, tone: "bg-emerald-100 text-emerald-700" };
  if (done > 0) return { text: `💗 ${done}/${book.totalChapters}`, tone: "bg-pink-100 text-pink-700" };
  if (book.failedChapters > 0) return { text: `💔 ${t.statusFailed}`, tone: "bg-rose-100 text-rose-700" };
  return { text: `⏳ ${t.statusImporting}`, tone: "bg-amber-100 text-amber-700" };
}

export function Library({ initialBooks }: { initialBooks: ApiBook[] }) {
  const { t } = useApp();
  const [books, setBooks] = useState(initialBooks);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return books;
    return books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(needle));
  }, [books, filter]);

  const remove = async (id: number) => {
    if (!window.confirm(t.deleteConfirm)) return;
    await fetch(`/api/books/${id}`, { method: "DELETE" });
    setBooks((previous) => previous.filter((book) => book.id !== id));
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-extrabold text-[var(--lc-plum)]">📚 {t.library}</h2>
        <input
          className="lc-input max-w-xs"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t.library}
        />
      </div>

      {filtered.length === 0 ? (
        <p className="lc-card p-6 text-center text-sm text-[var(--lc-muted)]">{t.libraryEmpty}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((book) => {
            const status = statusLabel(book, t);
            const percent = book.totalChapters ? Math.round(((book.doneChapters ?? 0) / book.totalChapters) * 100) : 0;
            return (
              <article key={book.id} className="lc-card lc-boing flex gap-3 p-3">
                <Link href={`/book/${book.id}`} className="shrink-0">
                  {book.hasCover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/books/${book.id}/cover`}
                      alt={book.title}
                      className="h-32 w-24 rounded-2xl object-cover shadow-[0_10px_24px_rgba(122,37,84,0.2)]"
                    />
                  ) : (
                    <span className="grid h-32 w-24 place-items-center rounded-2xl bg-white/70 text-3xl">🌷</span>
                  )}
                </Link>
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <Link href={`/book/${book.id}`} className="no-underline">
                    <h3 className="truncate text-base font-extrabold text-[var(--lc-plum)]">{book.title}</h3>
                    <p className="truncate text-xs text-[var(--lc-muted)]">{book.author || "—"}</p>
                  </Link>
                  <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.text}</span>
                  <div className="lc-progress h-3">
                    <span style={{ width: `${Math.max(percent, 3)}%` }} />
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Link href={`/book/${book.id}`} className="lc-btn-soft text-xs no-underline">
                      👀 {t.preview}
                    </Link>
                    <button type="button" className="lc-btn-soft text-xs" onClick={() => void remove(book.id)}>
                      🗑️ {t.delete}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
