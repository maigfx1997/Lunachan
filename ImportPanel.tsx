"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp, useCuteHearts } from "./Providers";
import { requestImport, runFetchLoop, type PipelineProgress } from "@/lib/client/pipeline";
import type { ApiBook, ApiChapter } from "@/lib/client/types";

type Phase = "idle" | "meta" | "chapters" | "done" | "error";

const SOURCE_CHIPS = ["Novlar", "Uranus-Novel", "Wattpad"];

export function ImportPanel() {
  const { t, locale } = useApp();
  const popHearts = useCuteHearts();
  const router = useRouter();

  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [book, setBook] = useState<ApiBook | null>(null);
  const [chapters, setChapters] = useState<ApiChapter[]>([]);
  const [progress, setProgress] = useState<PipelineProgress>({ total: 0, done: 0, failed: 0, currentIndex: 0 });
  const [error, setError] = useState("");
  const [pulse, setPulse] = useState(false);
  const stopped = useRef(false);

  useEffect(() => () => {
    stopped.current = true;
  }, []);

  const startImport = useCallback(async () => {
    const value = url.trim();
    if (!value) {
      setError(t.errorEmpty);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 600);
      return;
    }
    stopped.current = false;
    setError("");
    setBook(null);
    setChapters([]);
    setPhase("meta");
    popHearts(8);

    try {
      const result = await requestImport(value);
      setBook(result.book);
      setChapters(result.chapters);
      popHearts(12);

      const pending = result.chapters.filter((chapter) => chapter.status !== "done").map((chapter) => chapter.idx);
      if (pending.length === 0) {
        setPhase("done");
        window.setTimeout(() => router.push(`/book/${result.book.id}`), 900);
        return;
      }

      setPhase("chapters");
      setProgress({ total: pending.length, done: 0, failed: 0, currentIndex: pending[0] });

      await runFetchLoop(result.book.id, pending, {
        concurrency: 3,
        shouldStop: () => stopped.current,
        onBook: (fresh) => setBook(fresh),
        onTick: (chapter, next) => {
          setProgress(next);
          setChapters((previous) => {
            const others = previous.filter((item) => item.idx !== chapter.idx);
            return [...others, { ...chapter }].sort((a, b) => a.idx - b.idx);
          });
          if (next.done % 3 === 0) popHearts(4);
        },
      });

      setPhase("done");
      popHearts(24);
      window.setTimeout(() => router.push(`/book/${result.book.id}`), 1100);
    } catch (importError) {
      const code = (importError as Error & { code?: string }).code;
      const message = (importError as Error).message;
      setPhase("error");
      setError(
        code === "empty"
          ? t.errorEmpty
          : code === "invalid"
            ? t.errorInvalid
            : code === "truncated"
              ? t.errorTruncated
              : message && message !== "generic"
                ? message
                : t.errorGeneric,
      );
      setPulse(true);
      window.setTimeout(() => setPulse(false), 600);
    }
  }, [url, t, popHearts, router]);

  const percent = progress.total ? Math.round(((progress.done + progress.failed) / progress.total) * 100) : phase === "meta" ? 8 : 0;
  const active = phase === "meta" || phase === "chapters";

  return (
    <section className="lc-card relative overflow-hidden p-6 md:p-8">
      <div className="pointer-events-none absolute -top-16 -end-10 h-40 w-40 rounded-full bg-[var(--lc-glow)] blur-3xl" />
      <div className="relative space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-extrabold text-[var(--lc-plum)]">{t.pasteLabel}</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="lc-chip">💗 {t.everySite}</span>
            {SOURCE_CHIPS.map((chip) => (
              <span key={chip} className="lc-chip">
                {chip}
              </span>
            ))}
          </div>
        </div>

        <div className={`flex flex-col gap-3 md:flex-row ${pulse ? "lc-pop" : ""}`}>
          <input
            className="lc-input"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void startImport();
            }}
            placeholder={t.pastePlaceholder}
            dir="ltr"
            spellCheck={false}
            disabled={active}
          />
          <button type="button" className="lc-btn shrink-0" onClick={() => void startImport()} disabled={active}>
            {active ? t.importing : t.pasteButton}
          </button>
        </div>

        <p className="text-xs text-[var(--lc-muted)]">🔒 {t.pasteHint}</p>

        {phase !== "idle" && (
          <div className="lc-boing space-y-3 rounded-3xl border border-[var(--lc-border)] bg-white/70 p-4">
            <div className="flex items-center justify-between gap-3 text-sm font-bold text-[var(--lc-plum)]">
              <span className="flex items-center gap-2">
                {phase === "meta" && "🎀 "}
                {phase === "chapters" && "💞 "}
                {phase === "done" && "🎉 "}
                {phase === "error" && "🥺 "}
                {phase === "meta" && t.readingMeta}
                {phase === "chapters" && `${t.fetchingChapter} #${progress.currentIndex}`}
                {phase === "done" && t.done}
                {phase === "error" && t.errorGeneric}
              </span>
              {phase === "chapters" && (
                <span className="text-xs text-[var(--lc-muted)]">
                  {progress.done} / {progress.total} {locale === "ar" ? "" : ""}
                </span>
              )}
            </div>

            <div className="lc-progress">
              <span style={{ width: `${Math.max(percent, phase === "meta" ? 8 : 4)}%` }} />
            </div>

            {book && (
              <div className="flex items-center gap-3 text-sm">
                {book.hasCover ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/books/${book.id}/cover`}
                    alt={t.cover}
                    className="h-16 w-12 rounded-lg object-cover shadow-md"
                  />
                ) : (
                  <span className="grid h-16 w-12 place-items-center rounded-lg bg-white/70 text-xl">🌸</span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-bold text-[var(--lc-plum)]">{book.title}</p>
                  <p className="truncate text-xs text-[var(--lc-muted)]">
                    {book.author || "—"} • {chapters.length} {t.chaptersFound}
                  </p>
                </div>
              </div>
            )}

            {error && <p className="rounded-2xl bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
